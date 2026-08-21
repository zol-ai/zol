"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { zonedDate, zonedDayOfWeek, zonedToUtc } from "@/lib/schedule";
import type { FormState } from "./auth";

/**
 * Booking a bay.
 *
 * The no-double-booking rule is a GiST exclusion constraint in the schema, not
 * a check in this file, and that is deliberate: the agent will book slots
 * concurrently with whoever is at the counter, and two `SELECT ... then
 * INSERT` paths racing each other will happily put two cars on one lift.
 * Postgres refuses. What this file does is turn the refusal (23P01) into a
 * sentence a human can act on.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const DURATIONS = [30, 60, 90, 120, 180, 240, 480];

export async function bookAppointment(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const customerId = text(form, "customer_id");
  const vehicleId = text(form, "vehicle_id");
  const repairOrderId = text(form, "repair_order_id");
  const date = text(form, "date");
  const time = text(form, "time");
  const minutes = Number(text(form, "minutes"));
  const bay = text(form, "bay");

  const values = { date, time, minutes: String(minutes), bay };
  const fields: Record<string, string> = {};

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fields.date = "Pick a day.";
  if (!/^\d{2}:\d{2}$/.test(time)) fields.time = "Pick a time.";
  if (!DURATIONS.includes(minutes)) fields.minutes = "How long is it in for?";
  if (Object.keys(fields).length > 0) return { fields, values };

  const shops = await query<{
    timezone: string;
    bay_count: number;
  }>("SELECT timezone, bay_count FROM shops WHERE id = $1", [user.shopId]);
  const shop = shops[0];

  if (bay && (!Number.isInteger(Number(bay)) || Number(bay) < 1 || Number(bay) > shop.bay_count)) {
    fields.bay = `You have ${shop.bay_count} bays.`;
    return { fields, values };
  }

  const startsAt = zonedToUtc(date, time, shop.timezone);
  if (!startsAt) return { fields: { time: "That isn't a real time." }, values };
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

  const owner = await query<{ id: string }>(
    "SELECT id FROM customers WHERE id = $1 AND shop_id = $2",
    [customerId, user.shopId],
  );
  if (owner.length === 0) redirect("/app/customers");

  /*
    Outside opening hours is a warning, not a refusal. Shops take cars in
    before they open and hand them back after they close constantly, and a
    scheduler that argues about it is a scheduler people stop using. The
    agent's own booking rules are stricter — it may only *offer* slots inside
    hours — but a human typing the time is telling us something we don't know.
  */
  const day = zonedDayOfWeek(startsAt, shop.timezone);
  const hours = await query<{ is_closed: boolean }>(
    "SELECT is_closed FROM shop_hours WHERE shop_id = $1 AND day_of_week = $2",
    [user.shopId, day],
  );

  try {
    await query(
      `INSERT INTO appointments
         (shop_id, customer_id, vehicle_id, repair_order_id, bay,
          starts_at, ends_at, booked_by_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
      [
        user.shopId,
        customerId,
        vehicleId || null,
        repairOrderId || null,
        bay ? Number(bay) : null,
        startsAt,
        endsAt,
      ],
    );
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

  const closed = hours[0]?.is_closed ?? false;
  revalidatePath("/app/schedule");
  redirect(
    `/app/schedule?date=${zonedDate(startsAt, shop.timezone)}` +
      (closed ? "&note=closed" : ""),
  );
}

export async function setAppointmentStatus(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const status = text(form, "status");
  const date = text(form, "date");

  if (!["booked", "confirmed", "arrived", "no_show", "cancelled"].includes(status)) {
    redirect("/app/schedule");
  }

  await query(
    "UPDATE appointments SET status = $3 WHERE id = $1 AND shop_id = $2",
    [id, user.shopId, status],
  );

  revalidatePath("/app/schedule");
  redirect(`/app/schedule?date=${date}`);
}
