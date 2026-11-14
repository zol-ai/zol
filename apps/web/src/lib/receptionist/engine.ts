import "server-only";

import {
  collectedFrom,
  emptyCollected,
  replyForTurn,
  type Channel,
  type Collected,
  type KnownCustomer,
} from "@/lib/ai/receptionist";
import { db, query, tx, type Queryable } from "@/lib/db";
import { journeyMessage, queueFollowUp } from "@/lib/follow-ups";
import { formatWhen, vehicleLabel } from "@/lib/format";
import { notifyShop } from "@/lib/notifications";
import { formatPhone, toE164 } from "@/lib/phone";
import { zonedDate } from "@/lib/schedule";
import type { ConversationStatus } from "@/lib/statuses";
import { extractIntake, type Intake, type IntakeSource, type TranscriptLine } from "./intake";
import { durationForService, findOpenSlot, specialtyForService } from "./scheduling";

/**
 * The receptionist.
 *
 * One engine for every channel. The web chat at /talk/<slug> calls
 * `handleTurn` per message; the SMS webhook does the same once telephony is
 * switched on; the realtime media service, when it exists, will hand a
 * finished phone transcript to `finalizeVoiceCall`. All of them end in the
 * same place — `finalizeConversation` — which is the only code that turns a
 * conversation into a customer, a vehicle, an appointment, a confirmation
 * text and a note on the shop's bell. Channels differ in how the words arrive,
 * not in what happens to them.
 *
 * What the engine never does: diagnose, quote, or put a car somewhere the
 * scheduler (lib/receptionist/scheduling.ts) wouldn't. And it never talks to
 * the customer directly — every message that leaves the building goes through
 * `queueFollowUp`, and the reply on a live channel is handed back to the
 * caller for the channel to deliver.
 */

export interface StartConversationInput {
  shopId: string;
  channel: Channel;
  /** Known on SMS and voice; a web chat starts anonymous. */
  phone?: string | null;
  /** For the per-IP ceiling on the public chat. */
  ip?: string | null;
}

export interface Booking {
  appointmentId: string;
  startsAt: Date;
  endsAt: Date;
  bay: number;
  technicianId: string | null;
  technicianName: string | null;
  customerId: string;
  vehicleId: string | null;
  /** Text the customer sees, in the shop's zone: "Thursday, Sep 11 at 1:00 PM". */
  when: string;
  confirmationQueued: boolean;
}

export interface TurnOutcome {
  reply: string;
  state: ConversationStatus;
  booked?: Booking;
  source: "openai" | "fallback";
}

interface ShopRow {
  id: string;
  name: string;
  timezone: string;
  public_phone: string | null;
}

interface ConversationRow {
  id: string;
  shop_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  channel: Channel;
  phone: string | null;
  status: ConversationStatus;
  intake: unknown;
}

// -----------------------------------------------------------------------------
// Greeting
// -----------------------------------------------------------------------------

/** The first thing ZOL says. The /talk page renders the same words locally. */
export function greetingFor(shopName: string, channel: Channel): string {
  switch (channel) {
    case "voice":
      return `Thanks for calling ${shopName}, this is ZOL. How can I help?`;
    case "sms":
      return `${shopName}: this is ZOL, the shop's receptionist. Tell me what's going on with the vehicle and I'll find you a time.`;
    case "web":
    default:
      return `Hi, this is ZOL, the receptionist at ${shopName}. I can get your vehicle booked in — tell me what's going on and I'll take it from there.`;
  }
}

// -----------------------------------------------------------------------------
// Lookups
// -----------------------------------------------------------------------------

async function loadShop(client: Queryable, shopId: string): Promise<ShopRow | null> {
  const { rows } = await client.query<ShopRow>(
    "SELECT id, name, timezone, public_phone FROM shops WHERE id = $1",
    [shopId],
  );
  return rows[0] ?? null;
}

async function customerByPhone(
  client: Queryable,
  shopId: string,
  phone: string,
): Promise<KnownCustomer | null> {
  const { rows } = await client.query<{
    id: string;
    full_name: string | null;
    phone: string;
    sms_opted_out: boolean;
  }>(
    "SELECT id, full_name, phone, sms_opted_out FROM customers WHERE shop_id = $1 AND phone = $2",
    [shopId, phone],
  );
  const customer = rows[0];
  if (!customer) return null;

  const vehicles = await client.query<{
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
  }>(
    `SELECT id, year, make, model, trim FROM vehicles
      WHERE customer_id = $1 AND shop_id = $2
      ORDER BY created_at DESC`,
    [customer.id, shopId],
  );

  return {
    id: customer.id,
    fullName: customer.full_name,
    phone: customer.phone,
    smsOptedOut: customer.sms_opted_out,
    vehicles: vehicles.rows.map((v) => ({
      id: v.id,
      year: v.year,
      make: v.make,
      model: v.model,
      label: vehicleLabel(v) ?? "vehicle on file",
    })),
  };
}

async function loadConversation(client: Queryable, conversationId: string): Promise<ConversationRow | null> {
  const { rows } = await client.query<ConversationRow>(
    `SELECT id, shop_id, customer_id, vehicle_id, channel, phone, status, intake
       FROM conversations WHERE id = $1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

async function loadTranscript(client: Queryable, conversationId: string): Promise<TranscriptLine[]> {
  const { rows } = await client.query<TranscriptLine>(
    `SELECT role, content FROM conversation_messages
      WHERE conversation_id = $1 ORDER BY created_at, id`,
    [conversationId],
  );
  return rows;
}

async function addMessage(
  client: Queryable,
  conversationId: string,
  role: TranscriptLine["role"],
  content: string,
  structured?: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO conversation_messages (conversation_id, role, content, structured)
     VALUES ($1, $2, $3, $4)`,
    [conversationId, role, content, structured === undefined ? null : JSON.stringify(structured)],
  );
}

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------

export async function startConversation(
  input: StartConversationInput,
): Promise<{ conversationId: string; greeting: string }> {
  const shop = await loadShop(await db(), input.shopId);
  if (!shop) throw new Error("No such shop.");

  const phone = input.phone ? (toE164(input.phone) ?? null) : null;
  const customer = phone ? await customerByPhone(await db(), shop.id, phone) : null;

  // On a channel where the number is known, the conversation starts already
  // knowing who it might be; the state machine then skips those questions.
  const collected = emptyCollected({
    phone,
    customerName: customer?.fullName ?? null,
    returning: Boolean(customer),
  });

  const greeting = greetingFor(shop.name, input.channel);

  const conversationId = await tx(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO conversations (shop_id, customer_id, channel, phone, status, intake, ip)
       VALUES ($1, $2, $3, $4, 'open', $5, $6) RETURNING id`,
      [shop.id, customer?.id ?? null, input.channel, phone, JSON.stringify(collected), input.ip ?? null],
    );
    await addMessage(client, rows[0].id, "assistant", greeting);
    return rows[0].id;
  });

  return { conversationId, greeting };
}

// -----------------------------------------------------------------------------
// A turn
// -----------------------------------------------------------------------------

function bookingSentence(booking: Booking, shop: ShopRow, customerPhone: string | null): string {
  const who = booking.technicianName ? ` with ${booking.technicianName}` : "";
  const confirm = booking.confirmationQueued
    ? customerPhone
      ? ` A confirmation is on its way to ${formatPhone(customerPhone)}.`
      : " A confirmation is on its way."
    : " Texts to your number are switched off, so please make a note of the time.";
  const change = shop.public_phone
    ? ` If anything changes, reply here or call ${formatPhone(shop.public_phone)}.`
    : " If anything changes, reply here.";
  return `You're booked for ${booking.when}${who}, bay ${booking.bay}.${confirm}${change}`;
}

async function escalate(
  client: Queryable,
  shop: ShopRow,
  conversation: { id: string; channel: Channel; customer_id: string | null },
  collected: Collected,
  reason: string,
): Promise<void> {
  const who = collected.customerName ?? (collected.phone ? formatPhone(collected.phone) : "Unknown caller");
  await notifyShop(client, shop.id, {
    kind: "call",
    title: reason,
    body: `${who} · ${collected.complaint ?? "no complaint yet"}${collected.phone ? ` · ${formatPhone(collected.phone)}` : ""}`,
    href: conversation.customer_id ? `/app/customers/${conversation.customer_id}` : "/app/calls#conversations",
  });
  await client.query(
    `UPDATE conversations SET status = 'escalated' WHERE id = $1 AND status = 'open'`,
    [conversation.id],
  );
}

export async function handleTurn(input: { conversationId: string; text: string }): Promise<TurnOutcome> {
  const text = input.text.trim();
  const conversation = await loadConversation(await db(), input.conversationId);
  if (!conversation) throw new Error("No such conversation.");

  const shop = await loadShop(await db(), conversation.shop_id);
  if (!shop) throw new Error("No such shop.");

  // A finished conversation answers the same way every time.
  if (conversation.status === "booked") {
    return {
      reply: "You're already booked — the confirmation has the details. Reply here if you need to change anything and the shop will sort it.",
      state: "booked",
      source: "fallback",
    };
  }
  if (conversation.status === "completed" || conversation.status === "abandoned") {
    return {
      reply: `This conversation has closed. ${shop.public_phone ? `Call ${formatPhone(shop.public_phone)} and the shop will help.` : "The shop will help you directly."}`,
      state: conversation.status,
      source: "fallback",
    };
  }

  const collected = collectedFrom(conversation.intake);
  if (!collected.phone && conversation.phone) collected.phone = conversation.phone;

  const history = await loadTranscript(await db(), conversation.id);
  await addMessage(await db(), conversation.id, "customer", text);

  /*
    Who the number belongs to — on a channel that vouches for it. Twilio
    attests `From` on SMS and voice; on the web chat the visitor typed the
    number, and a typed number proves nothing. Looking it up there would
    greet a stranger by the account holder's first name, offer them the cars
    on file and hang the booking on that customer's record — the shop's
    customer list, keyed by phone, open to anyone with the URL. So the web
    channel resolves nothing: the visitor is asked for name and vehicle like
    any new caller, and `finalizeConversation` still matches by phone when it
    books, so a genuine returning customer gets no duplicate record either.
  */
  const attested = conversation.channel !== "web";
  const lookup = async (phone: string): Promise<KnownCustomer | null> =>
    attested ? customerByPhone(await db(), shop.id, phone) : null;
  const known = collected.phone ? await lookup(collected.phone) : null;

  const turn = await replyForTurn({
    shop: { name: shop.name, phone: shop.public_phone },
    channel: conversation.channel,
    collected,
    customer: known,
    history,
    latest: text,
    resolveCustomer: lookup,
  });

  let reply = turn.reply;
  let state: ConversationStatus = conversation.status;
  let booked: Booking | undefined;
  const next = turn.collected;

  // The number identified somebody — remember it on the row.
  if (turn.customer && turn.customer.id !== conversation.customer_id) {
    await query("UPDATE conversations SET customer_id = $2, phone = $3 WHERE id = $1", [
      conversation.id,
      turn.customer.id,
      turn.customer.phone,
    ]);
    conversation.customer_id = turn.customer.id;
  } else if (next.phone && next.phone !== conversation.phone) {
    await query("UPDATE conversations SET phone = $2 WHERE id = $1", [conversation.id, next.phone]);
  }

  // Safety: said plainly to the caller (already in the reply) and to the shop, once.
  if ((turn.safetyWarning || next.urgency === "stop_driving") && !next.escalatedAt) {
    next.escalatedAt = new Date().toISOString();
    await escalate(await db(), shop, conversation, next, "Caller may need to stop driving");
    state = "escalated";
  }

  // A status question or a pricing question is something a person should see.
  if ((turn.intent === "status" || turn.intent === "question") && !next.flaggedAt) {
    next.flaggedAt = new Date().toISOString();
    await notifyShop(await db(), shop.id, {
      kind: "call",
      title: turn.intent === "status" ? "Customer asked for an update" : "Customer asked a question ZOL couldn't answer",
      body: `${next.customerName ?? (next.phone ? formatPhone(next.phone) : "Web visitor")}: "${text.slice(0, 160)}"`,
      href: conversation.customer_id ? `/app/customers/${conversation.customer_id}` : "/app/calls#conversations",
    });
  }

  await query("UPDATE conversations SET intake = $2 WHERE id = $1", [conversation.id, JSON.stringify(next)]);

  if (turn.readyToBook) {
    const result = await finalizeConversation({ conversationId: conversation.id });
    if (result.status === "booked" && result.booking) {
      booked = result.booking;
      state = "booked";
      reply = `${turn.safetyWarning ? `${turn.safetyWarning} ` : ""}${bookingSentence(result.booking, shop, next.phone)}`;
    } else {
      state = "escalated";
      reply =
        `${turn.safetyWarning ? `${turn.safetyWarning} ` : ""}` +
        (result.status === "no_slot"
          ? `I couldn't find an opening in the next week. I've flagged this for the shop and someone will call you${next.phone ? ` at ${formatPhone(next.phone)}` : ""} to fit you in.`
          : `I couldn't finish the booking from here, but the shop has everything you've told me and will be in touch${next.phone ? ` at ${formatPhone(next.phone)}` : ""}.`);
    }
  }

  await addMessage(await db(), conversation.id, "assistant", reply, {
    intent: turn.intent,
    missing: turn.missing,
    readyToBook: turn.readyToBook,
    safetyWarning: turn.safetyWarning,
    source: turn.source,
    booked: booked ? { appointmentId: booked.appointmentId, startsAt: booked.startsAt.toISOString() } : null,
  });

  return { reply, state, booked, source: turn.source };
}

// -----------------------------------------------------------------------------
// Finalise: conversation → customer, vehicle, appointment, confirmation
// -----------------------------------------------------------------------------

export type FinalizeStatus = "booked" | "no_phone" | "no_slot";

export interface FinalizeResult {
  status: FinalizeStatus;
  intake: Intake;
  intakeSource: IntakeSource;
  customerId: string | null;
  vehicleId: string | null;
  booking?: Booking;
  /** True when the caller was not on file before this conversation. */
  newCustomer: boolean;
}

export async function finalizeConversation(input: {
  conversationId: string;
  /** Set for voice, so the appointment points back at the call. */
  callId?: string | null;
}): Promise<FinalizeResult> {
  const conversation = await loadConversation(await db(), input.conversationId);
  if (!conversation) throw new Error("No such conversation.");
  const shop = await loadShop(await db(), conversation.shop_id);
  if (!shop) throw new Error("No such shop.");

  const transcript = await loadTranscript(await db(), conversation.id);
  const collected = collectedFrom(conversation.intake);

  const { intake, source } = await extractIntake(transcript, {
    customerName: collected.customerName,
    phone: collected.phone ?? conversation.phone,
    vehicle: collected.vehicle.make ? collected.vehicle : null,
    complaint: collected.complaint,
    preferredTime: collected.preferredTime,
    urgency: collected.urgency,
    serviceType: collected.serviceType,
    symptoms: collected.symptoms,
    returning: collected.returning,
  });

  const phone = toE164(intake.phone ?? conversation.phone ?? "") ?? null;

  if (!phone) {
    // Nothing to attach a booking to. The transcript is kept; a person follows up.
    await tx(async (client) => {
      await client.query(
        `UPDATE conversations
            SET status = 'escalated', intake = $2, intake_source = $3, summary = $4
          WHERE id = $1`,
        [conversation.id, JSON.stringify(intake), source, intake.summary],
      );
      await notifyShop(client, shop.id, {
        kind: "call",
        title: "Conversation ended without a phone number",
        body: intake.summary,
        href: "/app/calls#conversations",
      });
    });
    return { status: "no_phone", intake, intakeSource: source, customerId: null, vehicleId: null, newCustomer: false };
  }

  return tx(async (client) => {
    // The customer, by phone. Fill blanks, never overwrite what the shop typed.
    const { rows: customers } = await client.query<{
      id: string;
      full_name: string | null;
      sms_opted_out: boolean;
      created: boolean;
    }>(
      `INSERT INTO customers (shop_id, phone, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (shop_id, phone) DO UPDATE
         SET full_name = COALESCE(customers.full_name, EXCLUDED.full_name)
       RETURNING id, full_name, sms_opted_out, (xmax = 0) AS created`,
      [shop.id, phone, intake.customerName],
    );
    const customer = customers[0];

    // The vehicle: the one they confirmed, the one on file that matches, or a new one.
    let vehicleId: string | null = collected.vehicleId;
    if (vehicleId) {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM vehicles WHERE id = $1 AND customer_id = $2 AND shop_id = $3",
        [vehicleId, customer.id, shop.id],
      );
      if (!rows[0]) vehicleId = null;
    }
    if (!vehicleId && intake.vehicle.make) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM vehicles
          WHERE customer_id = $1 AND shop_id = $2
            AND lower(make) = lower($3)
            AND ($4::text IS NULL OR model IS NULL OR lower(model) = lower($4))
            AND ($5::int IS NULL OR year IS NULL OR year = $5)
          ORDER BY (model IS NOT NULL) DESC, (year IS NOT NULL) DESC, created_at DESC
          LIMIT 1`,
        [customer.id, shop.id, intake.vehicle.make, intake.vehicle.model, intake.vehicle.year],
      );
      if (rows[0]) {
        vehicleId = rows[0].id;
        // Fill in what the caller told us that the record didn't have — when
        // the channel vouches for who is talking. A web visitor's number is
        // unverified, so their words never write into a record already on
        // file; the advisor fills the blanks at check-in.
        if (conversation.channel !== "web") {
          await client.query(
            `UPDATE vehicles SET year = COALESCE(year, $3), model = COALESCE(model, $4)
              WHERE id = $1 AND shop_id = $2`,
            [vehicleId, shop.id, intake.vehicle.year, intake.vehicle.model],
          );
        }
      } else {
        const { rows: created } = await client.query<{ id: string }>(
          `INSERT INTO vehicles (shop_id, customer_id, year, make, model)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [shop.id, customer.id, intake.vehicle.year, intake.vehicle.make, intake.vehicle.model],
        );
        vehicleId = created[0].id;
      }
    }

    const vehicleText = vehicleLabel(intake.vehicle);
    const complaint = intake.complaint ?? intake.serviceType ?? "Booked by ZOL";
    const specialty = specialtyForService(intake.serviceType, intake.complaint);
    const durationMin = durationForService(intake.serviceType);

    /*
      Find a slot and write it. A counter booking can land on the same bay
      between our read and our insert; the exclusion constraint refuses that
      with 23P01, which aborts the statement — so the insert sits behind a
      savepoint and we look again with the fresh calendar. Three tries is
      generous for a shop with four bays.
    */
    let appointmentId: string | null = null;
    let slot: Awaited<ReturnType<typeof findOpenSlot>> = null;
    for (let attempt = 0; attempt < 3 && !appointmentId; attempt++) {
      slot = await findOpenSlot(client, {
        shopId: shop.id,
        from: new Date(),
        durationMin,
        preferredTime: intake.preferredTime,
        specialty,
      });
      if (!slot) break;

      await client.query("SAVEPOINT booking");
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO appointments
             (shop_id, customer_id, vehicle_id, bay, starts_at, ends_at, status,
              booked_by_agent, technician_id, service_type, complaint, notes, source, call_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'booked', true, $7, $8, $9, $10, 'agent', $11)
           RETURNING id`,
          [
            shop.id,
            customer.id,
            vehicleId,
            slot.bay,
            slot.startsAt,
            slot.endsAt,
            slot.technicianId,
            intake.serviceType,
            complaint,
            intake.symptoms.length > 0 ? `Symptoms: ${intake.symptoms.join(", ")}` : null,
            input.callId ?? null,
          ],
        );
        appointmentId = rows[0].id;
        await client.query("RELEASE SAVEPOINT booking");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT booking");
        if ((error as { code?: string }).code !== "23P01") throw error;
      }
    }

    if (!appointmentId || !slot) {
      await client.query(
        `UPDATE conversations
            SET status = 'escalated', customer_id = $2, vehicle_id = $3,
                intake = $4, intake_source = $5, summary = $6
          WHERE id = $1`,
        [conversation.id, customer.id, vehicleId, JSON.stringify(intake), source, intake.summary],
      );
      await notifyShop(client, shop.id, {
        kind: "call",
        title: "ZOL couldn't find a slot this week",
        body: `${intake.customerName ?? formatPhone(phone)} · ${vehicleText ?? "vehicle"} · ${complaint} — call them to fit it in.`,
        href: `/app/customers/${customer.id}`,
      });
      return {
        status: "no_slot",
        intake,
        intakeSource: source,
        customerId: customer.id,
        vehicleId,
        newCustomer: customer.created,
      };
    }

    const when = formatWhen(slot.startsAt, shop.timezone);

    // The confirmation. Queued, not sent: the worker sends, and checks STOP again then.
    let confirmationQueued = false;
    if (!customer.sms_opted_out) {
      const message = journeyMessage("appointment_confirmed", {
        shopName: shop.name,
        shopPhone: shop.public_phone,
        firstName: intake.customerName?.split(" ")[0] ?? null,
        vehicle: vehicleText,
        when,
        technician: slot.technicianName,
        serviceType: intake.serviceType,
      });
      const queued = await queueFollowUp(client, {
        shopId: shop.id,
        customerId: customer.id,
        vehicleId,
        appointmentId,
        kind: "appointment_confirmed",
        title: message.title,
        body: message.body,
        details: `Booked by ZOL from a ${conversation.channel === "voice" ? "call" : conversation.channel === "sms" ? "text thread" : "web chat"}.`,
        source: "zol",
      });
      confirmationQueued = queued !== null;
    }

    const stopDriving = intake.urgency === "stop_driving";
    await notifyShop(client, shop.id, {
      kind: "appointment",
      title: `ZOL booked ${intake.serviceType?.toLowerCase() ?? "a visit"}${stopDriving ? " — told to stop driving" : ""}`,
      body: `${intake.customerName ?? formatPhone(phone)}${customer.created ? " (new)" : ""} · ${vehicleText ?? "vehicle"} · ${when}${slot.technicianName ? ` with ${slot.technicianName}` : ""}${customer.sms_opted_out ? " — texts stopped, call to confirm" : ""}`,
      href: input.callId ? `/app/calls/${input.callId}` : `/app/schedule?date=${zonedDate(slot.startsAt, shop.timezone)}`,
    });

    await client.query(
      `UPDATE conversations
          SET status = 'booked', customer_id = $2, vehicle_id = $3, appointment_id = $4,
              intake = $5, intake_source = $6, summary = $7, phone = $8
        WHERE id = $1`,
      [conversation.id, customer.id, vehicleId, appointmentId, JSON.stringify(intake), source, intake.summary, phone],
    );

    return {
      status: "booked",
      intake,
      intakeSource: source,
      customerId: customer.id,
      vehicleId,
      newCustomer: customer.created,
      booking: {
        appointmentId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        bay: slot.bay,
        technicianId: slot.technicianId,
        technicianName: slot.technicianName,
        customerId: customer.id,
        vehicleId,
        when,
        confirmationQueued,
      },
    };
  });
}

// -----------------------------------------------------------------------------
// Voice: a finished call, as a transcript
// -----------------------------------------------------------------------------

export interface VoiceCallInput {
  shopId: string;
  /** Twilio's CallSid. Null for a simulated call. */
  callSid: string | null;
  from: string;
  to: string;
  transcript: TranscriptLine[];
  durationSeconds: number;
  recordingUrl?: string | null;
  startedAt?: Date;
  /** The test-call button. Labelled everywhere, excluded from the rates. */
  simulated?: boolean;
}

export interface VoiceCallResult {
  callId: string;
  conversationId: string;
  outcome: "booked" | "escalated";
  booking?: Booking;
  intake: Intake;
  intakeSource: IntakeSource;
}

/**
 * The entry point for the realtime media service (see docs/TELEPHONY.md):
 * once a call ends, it posts the transcript here and this does everything a
 * web chat's `handleTurn` does at the end — writes the conversation and the
 * `calls` row, extracts the intake, matches or creates the customer and
 * vehicle, books, confirms and notifies. Idempotent on `callSid`: Twilio
 * retries webhooks, and a retried call must not book twice.
 */
export async function finalizeVoiceCall(input: VoiceCallInput): Promise<VoiceCallResult> {
  if (input.callSid) {
    const existing = await query<{ id: string; conversation_id: string | null; outcome: string | null; intake: Intake | null }>(
      "SELECT id, conversation_id, outcome, intake FROM calls WHERE twilio_call_sid = $1 AND shop_id = $2",
      [input.callSid, input.shopId],
    );
    if (existing[0]?.conversation_id && existing[0].intake) {
      return {
        callId: existing[0].id,
        conversationId: existing[0].conversation_id,
        outcome: existing[0].outcome === "booked" ? "booked" : "escalated",
        intake: existing[0].intake,
        intakeSource: "fallback",
      };
    }
  }

  const shop = await loadShop(await db(), input.shopId);
  if (!shop) throw new Error("No such shop.");

  const phone = toE164(input.from) ?? null;
  const customer = phone ? await customerByPhone(await db(), shop.id, phone) : null;
  const startedAt = input.startedAt ?? new Date(Date.now() - input.durationSeconds * 1000);
  const endedAt = new Date(startedAt.getTime() + input.durationSeconds * 1000);

  const { callId, conversationId } = await tx(async (client) => {
    const collected = emptyCollected({
      phone,
      customerName: customer?.fullName ?? null,
      returning: Boolean(customer),
    });
    const { rows: conv } = await client.query<{ id: string }>(
      `INSERT INTO conversations (shop_id, customer_id, channel, phone, status, intake, created_at)
       VALUES ($1, $2, 'voice', $3, 'open', $4, $5) RETURNING id`,
      [shop.id, customer?.id ?? null, phone, JSON.stringify(collected), startedAt],
    );
    const conversationId = conv[0].id;

    // Spread the lines across the call's duration so the transcript reads
    // in time, rather than every line stamped with the moment it was saved.
    const step = input.transcript.length > 1 ? (input.durationSeconds * 1000) / input.transcript.length : 0;
    for (const [index, line] of input.transcript.entries()) {
      await client.query(
        `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4)`,
        [conversationId, line.role, line.content, new Date(startedAt.getTime() + index * step)],
      );
    }

    const { rows: call } = await client.query<{ id: string }>(
      `INSERT INTO calls
         (shop_id, customer_id, twilio_call_sid, direction, from_number, to_number,
          started_at, ended_at, duration_seconds, recording_url, transcript,
          status, conversation_id, simulated, handled_by)
       VALUES ($1, $2, $3, 'inbound', $4, $5, $6, $7, $8, $9, $10, 'processing', $11, $12, 'zol')
       RETURNING id`,
      [
        shop.id,
        customer?.id ?? null,
        input.callSid,
        input.from,
        input.to,
        startedAt,
        endedAt,
        input.durationSeconds,
        input.recordingUrl ?? null,
        JSON.stringify(input.transcript),
        conversationId,
        input.simulated ?? false,
      ],
    );
    return { callId: call[0].id, conversationId };
  });

  let result: FinalizeResult;
  try {
    result = await finalizeConversation({ conversationId, callId });
  } catch (error) {
    // The call row must not sit in 'processing' forever; a person picks it up.
    await query(
      `UPDATE calls SET status = 'escalated', outcome = 'failed', escalation_required = true,
              summary = $2 WHERE id = $1`,
      [callId, `ZOL could not write this call up: ${error instanceof Error ? error.message : "unknown error"}`],
    );
    throw error;
  }

  const booked = result.status === "booked";
  const stopDriving = result.intake.urgency === "stop_driving";

  await query(
    `UPDATE calls
        SET status = $2, outcome = $3, caller_name = $4, summary = $5, intake = $6,
            customer_id = $7, vehicle_id = $8, appointment_id = $9,
            escalation_required = $10, sentiment = $11
      WHERE id = $1`,
    [
      callId,
      booked && !stopDriving ? "completed" : "escalated",
      booked ? "booked" : "escalated",
      result.intake.customerName,
      result.intake.summary,
      JSON.stringify(result.intake),
      result.customerId,
      result.vehicleId,
      result.booking?.appointmentId ?? null,
      !booked || stopDriving,
      // Nothing here reads emotion out of text. The intake's urgency is the
      // honest proxy the call list can sort by.
      stopDriving ? "Alarmed" : result.intake.urgency === "urgent" ? "Concerned" : null,
    ],
  );

  return {
    callId,
    conversationId,
    outcome: booked ? "booked" : "escalated",
    booking: result.booking,
    intake: result.intake,
    intakeSource: result.intakeSource,
  };
}
