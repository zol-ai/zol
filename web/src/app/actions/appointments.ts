"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { journeyMessage, queueFollowUp } from "@/lib/follow-ups";
import { formatTime, formatWhen, vehicleLabel } from "@/lib/format";
import { notifyShop } from "@/lib/notifications";
import { formatPhone } from "@/lib/phone";
import { mintPortalToken, portalPath } from "@/lib/portal";
import { openRepairOrder } from "@/lib/repair-orders-db";
import { requestOrigin } from "@/lib/request-origin";
import { zonedDate, zonedDayOfWeek, zonedToUtc } from "@/lib/schedule";
import { SOURCES, type Source } from "@/lib/statuses";
import type { FormState } from "./auth";

/**
 * Booking a bay, and what happens when the car turns up.
 *
 * The no-double-booking rule for bays is a GiST exclusion constraint in the
 * schema, not a check in this file, and that is deliberate: the receptionist
 * books slots concurrently with whoever is at the counter, and two
 * `SELECT ... then INSERT` paths racing each other will happily put two cars
 * on one lift. Postgres refuses. What this file does is turn the refusal
 * (23P01) into a sentence a human can act on.
 *
 * Technicians have no such constraint — a tech double-booked is a soft
 * problem, a bay double-booked is two cars and one lift — so that check is a
 * query here, serialised per technician with an advisory lock so two advisors
 * can't both pass it at once.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID.test(value);

const DURATIONS = [30, 60, 90, 120, 180, 240, 480];

interface Technician {
  id: string;
  full_name: string;
}

/** The tech has to be this shop's — a uuid from a form could be anyone's. */
async function technicianFor(shopId: string, id: string): Promise<Technician | null> {
  if (!isUuid(id)) return null;
  const rows = await query<Technician>(
    `SELECT id, full_name FROM staff
      WHERE id = $1 AND shop_id = $2 AND role = 'tech' AND disabled_at IS NULL`,
    [id, shopId],
  );
  return rows[0] ?? null;
}

// -----------------------------------------------------------------------------
// Book
// -----------------------------------------------------------------------------

export async function bookAppointment(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const customerId = text(form, "customer_id");
  const vehicleId = text(form, "vehicle_id");
  const repairOrderId = text(form, "repair_order_id");
  const technicianId = text(form, "technician_id");
  const date = text(form, "date");
  const time = text(form, "time");
  const minutes = Number(text(form, "minutes"));
  const bay = text(form, "bay");
  const serviceType = text(form, "service_type");
  const complaint = text(form, "complaint");
  const notes = text(form, "notes");

  const values = {
    date,
    time,
    minutes: String(minutes),
    bay,
    technician_id: technicianId,
    service_type: serviceType,
    complaint,
    notes,
    vehicle_id: vehicleId,
    repair_order_id: repairOrderId,
  };
  const fields: Record<string, string> = {};

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fields.date = "Pick a day.";
  if (!/^\d{2}:\d{2}$/.test(time)) fields.time = "Pick a time.";
  if (!DURATIONS.includes(minutes)) fields.minutes = "How long is it in for?";
  if (serviceType.length > 80) fields.service_type = "Keep it under 80 characters.";
  if (complaint.length > 500) fields.complaint = "Keep it under 500 characters.";
  if (notes.length > 1000) fields.notes = "Keep it under 1000 characters.";
  if (technicianId && !isUuid(technicianId)) fields.technician_id = "Pick a technician from the list.";
  if (Object.keys(fields).length > 0) return { fields, values };

  const shops = await query<{
    timezone: string;
    bay_count: number;
    public_phone: string | null;
  }>("SELECT timezone, bay_count, public_phone FROM shops WHERE id = $1", [user.shopId]);
  const shop = shops[0];

  if (bay && (!Number.isInteger(Number(bay)) || Number(bay) < 1 || Number(bay) > shop.bay_count)) {
    fields.bay = `You have ${shop.bay_count} bays.`;
    return { fields, values };
  }

  const startsAt = zonedToUtc(date, time, shop.timezone);
  if (!startsAt) return { fields: { time: "That isn't a real time." }, values };
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

  if (!isUuid(customerId)) redirect("/app/customers");
  const owners = await query<{
    id: string;
    full_name: string | null;
    phone: string;
    sms_opted_out: boolean;
  }>("SELECT id, full_name, phone, sms_opted_out FROM customers WHERE id = $1 AND shop_id = $2", [
    customerId,
    user.shopId,
  ]);
  const owner = owners[0];
  if (!owner) redirect("/app/customers");

  const technician = technicianId ? await technicianFor(user.shopId, technicianId) : null;
  if (technicianId && !technician) {
    return { fields: { technician_id: "That technician isn't on this shop's team." }, values };
  }

  // The vehicle and the ticket both have to be the customer's, not just a uuid.
  const vehicles =
    vehicleId && isUuid(vehicleId)
      ? await query<{ id: string; year: number | null; make: string | null; model: string | null; trim: string | null }>(
          "SELECT id, year, make, model, trim FROM vehicles WHERE id = $1 AND customer_id = $2 AND shop_id = $3",
          [vehicleId, owner.id, user.shopId],
        )
      : [];
  const vehicle = vehicles[0] ?? null;
  const vehicleText = vehicle ? vehicleLabel(vehicle) : null;

  const tickets =
    repairOrderId && isUuid(repairOrderId)
      ? await query<{ id: string }>(
          "SELECT id FROM repair_orders WHERE id = $1 AND customer_id = $2 AND shop_id = $3",
          [repairOrderId, owner.id, user.shopId],
        )
      : [];
  const ticketId = tickets[0]?.id ?? null;

  /*
    Outside opening hours is a warning, not a refusal. Shops take cars in
    before they open and hand them back after they close constantly, and a
    scheduler that argues about it is a scheduler people stop using. The
    receptionist's own rules are stricter — it may only *offer* slots inside
    hours — but a human typing the time is telling us something we don't know.
  */
  const day = zonedDayOfWeek(startsAt, shop.timezone);
  const hours = await query<{ is_closed: boolean }>(
    "SELECT is_closed FROM shop_hours WHERE shop_id = $1 AND day_of_week = $2",
    [user.shopId, day],
  );

  const when = formatWhen(startsAt, shop.timezone);
  let outcome: { id: string } | { conflict: string };

  try {
    outcome = await tx(async (client) => {
      if (technician) {
        // One booking at a time per technician, so two counters can't both
        // read "free" and both write. Released with the transaction.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [technician.id]);
        const clash = await client.query<{
          starts_at: string;
          ends_at: string;
          customer_name: string | null;
          vehicle: string | null;
        }>(
          `SELECT a.starts_at::text, a.ends_at::text, c.full_name AS customer_name,
                  nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle
             FROM appointments a
             JOIN customers c ON c.id = a.customer_id
             LEFT JOIN vehicles v ON v.id = a.vehicle_id
            WHERE a.shop_id = $1 AND a.technician_id = $2
              AND a.status IN ('booked', 'confirmed', 'arrived')
              AND tstzrange(a.starts_at, a.ends_at) && tstzrange($3, $4)
            ORDER BY a.starts_at
            LIMIT 1`,
          [user.shopId, technician.id, startsAt, endsAt],
        );
        const other = clash.rows[0];
        if (other) {
          return {
            conflict:
              `${technician.full_name} is already booked ${formatTime(other.starts_at, shop.timezone)}–` +
              `${formatTime(other.ends_at, shop.timezone)} with ${other.customer_name ?? "another customer"}` +
              `${other.vehicle ? ` (${other.vehicle})` : ""}. Pick another technician or another time.`,
          };
        }
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO appointments
           (shop_id, customer_id, vehicle_id, repair_order_id, bay, starts_at, ends_at,
            booked_by_agent, technician_id, service_type, complaint, notes, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, $11, 'counter')
         RETURNING id`,
        [
          user.shopId,
          owner.id,
          vehicle?.id ?? null,
          ticketId,
          bay ? Number(bay) : null,
          startsAt,
          endsAt,
          technician?.id ?? null,
          serviceType || null,
          complaint || null,
          notes || null,
        ],
      );
      const id = inserted.rows[0].id;

      // The confirmation goes out through the queue like every other message;
      // a customer who texted STOP gets nothing, and the row says so.
      if (!owner.sms_opted_out) {
        const message = journeyMessage("appointment_confirmed", {
          shopName: user.shopName,
          shopPhone: shop.public_phone,
          firstName: owner.full_name?.split(" ")[0] ?? null,
          vehicle: vehicleText,
          when,
          technician: technician?.full_name ?? null,
          serviceType: serviceType || null,
        });
        await queueFollowUp(client, {
          shopId: user.shopId,
          customerId: owner.id,
          vehicleId: vehicle?.id ?? null,
          repairOrderId: ticketId,
          appointmentId: id,
          kind: "appointment_confirmed",
          title: message.title,
          body: message.body,
          details: `Booked at the counter by ${user.fullName}.`,
          source: "person",
        });
      }

      await notifyShop(client, user.shopId, {
        kind: "appointment",
        title: `Booked: ${owner.full_name ?? formatPhone(owner.phone)} · ${when}`,
        body:
          [
            vehicleText,
            serviceType || null,
            technician ? `with ${technician.full_name}` : null,
            bay ? `bay ${bay}` : null,
            owner.sms_opted_out ? "texts stopped — confirm by phone" : "confirmation queued",
          ]
            .filter(Boolean)
            .join(" · ") || null,
        href: `/app/schedule?date=${zonedDate(startsAt, shop.timezone)}`,
      });

      return { id };
    });
  } catch (error) {
    // 23P01 — appointments_no_bay_overlap. The database is the only place
    // this can be decided correctly, so this is the only place it's reported.
    if ((error as { code?: string }).code === "23P01") {
      return {
        values,
        error: `Bay ${bay} already has a car in it then. Pick another bay or another time.`,
      };
    }
    throw error;
  }

  if ("conflict" in outcome) return { values, error: outcome.conflict };

  const closed = hours[0]?.is_closed ?? false;
  revalidatePath("/app/schedule");
  redirect(
    `/app/schedule?date=${zonedDate(startsAt, shop.timezone)}&note=${closed ? "closed" : "booked"}`,
  );
}

// -----------------------------------------------------------------------------
// Confirm, no-show, cancel
// -----------------------------------------------------------------------------

const STATUS_BUTTONS = ["confirmed", "no_show", "cancelled"] as const;

export async function setAppointmentStatus(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const status = text(form, "status");
  const date = text(form, "date");
  const back = `/app/schedule${/^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ""}`;

  if (!isUuid(id) || !(STATUS_BUTTONS as readonly string[]).includes(status)) redirect(back);

  await tx(async (client) => {
    // Only a booking that hasn't happened yet can be confirmed or written
    // off. Arrival goes through check-in, which opens the ticket.
    const { rows } = await client.query<{ id: string }>(
      `UPDATE appointments
          SET status = $3,
              confirmed_at = CASE WHEN $3 = 'confirmed' THEN coalesce(confirmed_at, now())
                                  ELSE confirmed_at END
        WHERE id = $1 AND shop_id = $2 AND status IN ('booked', 'confirmed')
        RETURNING id`,
      [id, user.shopId, status],
    );
    if (!rows[0]) return;

    if (status === "cancelled" || status === "no_show") {
      // A reminder for a visit that isn't happening must not go out — and
      // only for this visit. Matching on the customer swept the confirmation
      // for the other booking they still have, which is why the follow-up
      // carries the appointment it is about.
      await client.query(
        `UPDATE follow_ups SET status = 'cancelled'
          WHERE shop_id = $1 AND appointment_id = $2 AND status = 'pending'
            AND kind IN ('appointment_confirmed', 'appointment_reminder')`,
        [user.shopId, id],
      );
    }
  });

  revalidatePath("/app/schedule");
  redirect(back);
}

// -----------------------------------------------------------------------------
// Check-in: the car is here, open the ticket
// -----------------------------------------------------------------------------

export async function checkInAppointment(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const appointmentId = text(form, "appointment_id");
  const mileage = text(form, "mileage").replace(/[,\s]/g, "");
  const fuel = text(form, "fuel");
  const damage = text(form, "damage");
  const notes = text(form, "notes");
  const technicianId = text(form, "technician_id");
  const promised = text(form, "promised");
  const complaint = text(form, "complaint");

  const values = { mileage, fuel, damage, notes, technician_id: technicianId, promised, complaint };
  const fields: Record<string, string> = {};

  if (!isUuid(appointmentId)) return { error: "That appointment isn't on the book any more." };
  if (mileage && !/^\d{1,7}$/.test(mileage)) fields.mileage = "Numbers only.";
  if (fuel && !(/^\d{1,3}$/.test(fuel) && Number(fuel) <= 100)) fields.fuel = "0 to 100.";
  if (complaint.length < 3) fields.complaint = "What are they here for? Their words are fine.";
  if (complaint.length > 500) fields.complaint = "Keep it under 500 characters.";
  if (damage.length > 1000) fields.damage = "Keep it under 1000 characters.";
  if (notes.length > 1000) fields.notes = "Keep it under 1000 characters.";
  if (promised && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(promised)) fields.promised = "Pick a date and time.";
  if (technicianId && !isUuid(technicianId)) fields.technician_id = "Pick a technician from the list.";
  if (Object.keys(fields).length > 0) return { fields, values };

  const rows = await query<{
    id: string;
    customer_id: string;
    vehicle_id: string | null;
    status: string;
    repair_order_id: string | null;
    source: string;
    technician_id: string | null;
    full_name: string | null;
    phone: string;
    sms_opted_out: boolean;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    timezone: string;
    public_phone: string | null;
  }>(
    `SELECT a.id, a.customer_id, a.vehicle_id, a.status, a.repair_order_id, a.source, a.technician_id,
            c.full_name, c.phone, c.sms_opted_out,
            v.year, v.make, v.model, v.trim,
            s.timezone, s.public_phone
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       JOIN shops s ON s.id = a.shop_id
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
      WHERE a.id = $1 AND a.shop_id = $2`,
    [appointmentId, user.shopId],
  );
  const appointment = rows[0];
  if (!appointment) return { error: "That appointment isn't on the book any more." };

  // Already checked in — two advisors, one car. The ticket is the answer.
  if (appointment.repair_order_id) redirect(`/app/repair-orders/${appointment.repair_order_id}`);
  if (appointment.status === "cancelled" || appointment.status === "no_show") {
    return { values, error: "This appointment was written off. Book them in again first." };
  }

  const technician = technicianId ? await technicianFor(user.shopId, technicianId) : null;
  if (technicianId && !technician) {
    return { values, fields: { technician_id: "That technician isn't on this shop's team." } };
  }

  let promisedAt: Date | null = null;
  if (promised) {
    const [day, clock] = promised.split("T");
    promisedAt = zonedToUtc(day, clock, appointment.timezone) ?? null;
    if (!promisedAt) return { values, fields: { promised: "That isn't a real time." } };
  }

  const origin = await requestOrigin();
  const source: Source = (SOURCES as readonly string[]).includes(appointment.source)
    ? (appointment.source as Source)
    : "counter";
  const vehicleText = vehicleLabel(appointment);

  const opened = await tx(async (client) => {
    const ro = await openRepairOrder(client, {
      shopId: user.shopId,
      customerId: appointment.customer_id,
      vehicleId: appointment.vehicle_id,
      complaint,
      mileageIn: mileage ? Number(mileage) : null,
      technicianId: technician?.id ?? appointment.technician_id ?? null,
      appointmentId: appointment.id,
      source,
      fuelLevel: fuel ? Number(fuel) : null,
      visibleDamage: damage || null,
      checkInNotes: notes || null,
      promisedAt,
      staffId: user.staffId,
      actor: "person",
    });

    if (!appointment.sms_opted_out) {
      const token = await mintPortalToken(client, {
        shopId: user.shopId,
        customerId: appointment.customer_id,
        repairOrderId: ro.id,
      });
      const message = journeyMessage("checked_in", {
        shopName: user.shopName,
        shopPhone: appointment.public_phone,
        firstName: appointment.full_name?.split(" ")[0] ?? null,
        vehicle: vehicleText,
        roNumber: ro.number,
        portalUrl: origin + portalPath(token),
      });
      await queueFollowUp(client, {
        shopId: user.shopId,
        customerId: appointment.customer_id,
        repairOrderId: ro.id,
        vehicleId: appointment.vehicle_id,
        kind: "checked_in",
        title: message.title,
        body: message.body,
        source: "person",
      });
    }

    await notifyShop(client, user.shopId, {
      kind: "check_in",
      title: `#${ro.number} checked in`,
      body: `${appointment.full_name ?? formatPhone(appointment.phone)} · ${vehicleText ?? "vehicle"}${
        technician ? ` · ${technician.full_name}` : ""
      }${appointment.sms_opted_out ? " · texts stopped" : ""}`,
      href: `/app/repair-orders/${ro.id}`,
    });

    return ro;
  });

  revalidatePath("/app/schedule");
  revalidatePath("/app/repair-orders");
  redirect(`/app/repair-orders/${opened.id}`);
}
