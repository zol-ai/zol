import "server-only";

import { z } from "zod";

import { toE164 } from "@/lib/phone";
import {
  classifyUrgency,
  complaintFrom,
  isNoPreference,
  maxUrgency,
  parseBareName,
  parseName,
  parsePhone,
  parsePreferredTime,
  parseVehicle,
  safetyAdviceFor,
  serviceTypeFor,
  symptomsIn,
  vehicleWords,
  type ParsedVehicle,
} from "@/lib/receptionist/intake";
import { URGENCIES, type Urgency } from "@/lib/statuses";
import { structuredCompletion } from "./client";

/**
 * One turn of the receptionist: the customer said something, what does ZOL
 * say back, and what does it now know?
 *
 * Two implementations behind one function. With an OpenAI key the model runs
 * the conversation — it reads the history, keeps the collected facts, decides
 * the next question and says when it has enough to book. Without one (every
 * local machine, and the minute the API is down) a state machine asks the
 * same five things one at a time and books when they're answered. Both are
 * bound by the same rules, and the engine treats their output identically:
 * facts go into `collected`, the reply goes to the customer, `readyToBook` is
 * honoured only when the required facts are actually present.
 *
 * What neither is allowed to do: diagnose, quote, or invent a time. The
 * scheduler books; the reply that states the time is composed by the engine
 * from the row it wrote.
 */

export type Channel = "voice" | "web" | "sms";
export type Intent = "book" | "status" | "question" | "other";
export type MissingField = "customerName" | "phone" | "vehicle" | "complaint" | "preferredTime";
type PendingQuestion = MissingField | "vehicleConfirm";

/** A vehicle on file for a returning customer, as offered back to them. */
export interface KnownVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  label: string;
}

export interface KnownCustomer {
  id: string;
  fullName: string | null;
  phone: string;
  smsOptedOut: boolean;
  vehicles: KnownVehicle[];
}

/**
 * Everything the conversation has established so far. Stored on
 * `conversations.intake` while the conversation is open, replaced by the
 * full intake when it's finalised.
 */
export interface Collected {
  customerName: string | null;
  phone: string | null;
  vehicle: ParsedVehicle;
  /** Set when a returning customer confirmed a car already on file. */
  vehicleId: string | null;
  complaint: string | null;
  symptoms: string[];
  urgency: Urgency;
  serviceType: string | null;
  preferredTime: string | null;
  /** The question ZOL asked last, so a bare "Jordan Lee" can be read in context. */
  pending: PendingQuestion | null;
  /** Vehicles offered to a returning customer, for "the Civic" / "the first one". */
  offered: KnownVehicle[];
  returning: boolean;
  /** How often each question has been asked; some are relaxed after a retry. */
  asked: Partial<Record<MissingField, number>>;
  /** ISO time staff were alerted about this conversation, so it happens once. */
  escalatedAt: string | null;
  /** Set once a status/question intent has been flagged to staff. */
  flaggedAt: string | null;
}

export function emptyCollected(seed: Partial<Collected> = {}): Collected {
  return {
    customerName: null,
    phone: null,
    vehicle: { year: null, make: null, model: null },
    vehicleId: null,
    complaint: null,
    symptoms: [],
    urgency: "routine",
    serviceType: null,
    preferredTime: null,
    pending: null,
    offered: [],
    returning: false,
    asked: {},
    escalatedAt: null,
    flaggedAt: null,
    ...seed,
  };
}

/** Reads a stored `intake` jsonb back into shape, tolerating older rows. */
export function collectedFrom(raw: unknown): Collected {
  if (!raw || typeof raw !== "object") return emptyCollected();
  const r = raw as Partial<Collected> & { vehicle?: Partial<ParsedVehicle> | null };
  return emptyCollected({
    ...r,
    vehicle: {
      year: r.vehicle?.year ?? null,
      make: r.vehicle?.make ?? null,
      model: r.vehicle?.model ?? null,
    },
    symptoms: Array.isArray(r.symptoms) ? r.symptoms : [],
    offered: Array.isArray(r.offered) ? r.offered : [],
    asked: r.asked && typeof r.asked === "object" ? r.asked : {},
    urgency: (URGENCIES as readonly string[]).includes(r.urgency ?? "") ? (r.urgency as Urgency) : "routine",
  });
}

export interface TurnInput {
  shop: { name: string; phone: string | null };
  channel: Channel;
  collected: Collected;
  customer: KnownCustomer | null;
  /** Prior lines, oldest first, not including `latest`. */
  history: { role: "assistant" | "customer" | "system"; content: string }[];
  latest: string;
  /**
   * Looks a phone number up once the caller has given one. Always null on a
   * channel that can't vouch for the number (the web chat): nothing on file
   * may be greeted, offered or booked against from a typed number. The
   * engine decides that; see `handleTurn`.
   */
  resolveCustomer: (phone: string) => Promise<KnownCustomer | null>;
}

export interface TurnResult {
  reply: string;
  intent: Intent;
  missing: MissingField[];
  readyToBook: boolean;
  safetyWarning: string | null;
  collected: Collected;
  customer: KnownCustomer | null;
  source: "openai" | "fallback";
}

// -----------------------------------------------------------------------------
// Shared rules
// -----------------------------------------------------------------------------

function firstName(name: string | null): string | null {
  return name?.split(/\s+/)[0] ?? null;
}

function count(asked: Collected["asked"], field: MissingField): number {
  return asked[field] ?? 0;
}

/**
 * What's still needed before a booking can be written, in the order it's
 * asked. Phone is never optional — it is the customer's identity. The rest
 * are relaxed after a couple of tries so a caller who can't say what year
 * the car is still gets a slot; the advisor fills the gap at check-in.
 */
export function missingFields(c: Collected): MissingField[] {
  const out: MissingField[] = [];
  if (!c.customerName && count(c.asked, "customerName") < 2) out.push("customerName");
  if (!c.phone) out.push("phone");
  if (!c.vehicle.make && !c.vehicleId && count(c.asked, "vehicle") < 2) out.push("vehicle");
  if (!c.complaint && count(c.asked, "complaint") < 2) out.push("complaint");
  if (!c.preferredTime && count(c.asked, "preferredTime") < 1) out.push("preferredTime");
  return out;
}

const YES = /^\s*(yes|yeah|yep|yup|correct|right|that's (right|it|the one)|it is|sure|uh huh|mm-?hmm|please)\b/i;
const NO = /\b(no|nope|nah|different|another|other one|not that)\b/i;
const STATUS_INTENT =
  /\b(is (my|the) (car|truck|vehicle) (ready|done)|any update|status|when will it be (ready|done)|ready yet|still working on)\b/i;
const PRICE_INTENT = /\b(how much|price|pricing|cost|quote|estimate|charge)\b/i;
const BOOKING_CONTEXT = /\b(book|appointment|come in|bring it|drop it|get it in|slot|available|schedule|fit (me|it) in|see it)\b/i;

function vehicleLabel(c: Collected): string {
  return vehicleWords(c.vehicle) ?? "the vehicle";
}

// -----------------------------------------------------------------------------
// The fallback: one question at a time
// -----------------------------------------------------------------------------

async function fallbackTurn(input: TurnInput): Promise<TurnResult> {
  const c: Collected = { ...input.collected, vehicle: { ...input.collected.vehicle }, asked: { ...input.collected.asked } };
  let customer = input.customer;
  const latest = input.latest.trim();
  const lower = latest.toLowerCase();

  // Safety first, on every turn, whatever question was pending.
  const urgencyNow = classifyUrgency(latest);
  c.urgency = maxUrgency(c.urgency, urgencyNow);
  for (const s of symptomsIn(latest)) if (!c.symptoms.includes(s)) c.symptoms.push(s);
  const safetyWarning = urgencyNow === "stop_driving" ? safetyAdviceFor("stop_driving", latest) : null;

  let intent: Intent = "book";
  let ack = "";

  // 1. Read the answer to whatever was asked last.
  switch (c.pending) {
    case "customerName": {
      const name = parseBareName(latest);
      if (name) c.customerName = name;
      break;
    }
    case "phone": {
      const phone = parsePhone(latest);
      if (phone) c.phone = phone;
      break;
    }
    case "vehicleConfirm": {
      const offered = c.offered[0];
      if (offered && YES.test(latest)) {
        c.vehicle = { year: offered.year, make: offered.make, model: offered.model };
        c.vehicleId = offered.id;
      } else {
        const v = parseVehicle(latest);
        if (v.make) {
          c.vehicle = v;
          c.vehicleId = null;
        } else if (offered && !NO.test(latest)) {
          // Not a yes, not a no, not a car: assume they moved on and it's the
          // one on file. A wrong car is corrected at check-in; a stuck chat isn't.
          c.vehicle = { year: offered.year, make: offered.make, model: offered.model };
          c.vehicleId = offered.id;
        }
      }
      c.offered = [];
      break;
    }
    case "vehicle": {
      const v = parseVehicle(latest);
      if (v.make) {
        c.vehicle = v;
        c.vehicleId = null;
      } else if (c.offered.length > 0) {
        const ordinal = /\b(first|1st|one)\b/.test(lower) ? 0 : /\b(second|2nd|two)\b/.test(lower) ? 1 : /\b(third|3rd)\b/.test(lower) ? 2 : -1;
        const byWord = c.offered.findIndex(
          (o) =>
            (o.model && lower.includes(o.model.toLowerCase())) ||
            (o.make && lower.includes(o.make.toLowerCase())) ||
            (o.year && lower.includes(String(o.year))),
        );
        const pick = c.offered[byWord >= 0 ? byWord : ordinal];
        if (pick) {
          c.vehicle = { year: pick.year, make: pick.make, model: pick.model };
          c.vehicleId = pick.id;
        }
      }
      c.offered = [];
      break;
    }
    case "complaint": {
      if (latest.length >= 3 && !YES.test(latest)) {
        c.complaint = latest.slice(0, 400);
      }
      break;
    }
    case "preferredTime": {
      if (isNoPreference(latest)) c.preferredTime = "Earliest available";
      else c.preferredTime = parsePreferredTime(latest) ?? latest.slice(0, 80);
      break;
    }
    default:
      break;
  }

  // 2. Anything else the message happened to contain.
  if (!c.customerName) c.customerName = parseName(latest);
  if (!c.phone) c.phone = parsePhone(latest);
  if (!c.vehicle.make && !c.vehicleId) {
    const v = parseVehicle(latest);
    if (v.make) c.vehicle = v;
  }
  if (!c.complaint && c.pending !== "customerName" && c.pending !== "phone" && c.pending !== "preferredTime") {
    const complaint = complaintFrom([latest]);
    if (complaint && (urgencyNow !== "routine" || serviceTypeFor(latest))) {
      c.complaint = complaint;
      ack = urgencyNow === "routine" ? "" : "Sorry to hear that — let's get it looked at. ";
    }
  }
  if (!c.preferredTime && c.pending !== "preferredTime" && BOOKING_CONTEXT.test(lower)) {
    const when = parsePreferredTime(latest);
    if (when) c.preferredTime = when;
  }
  if (c.complaint && !c.serviceType) c.serviceType = serviceTypeFor(`${c.complaint} ${latest}`);

  // 3. A phone number is a customer, maybe one we know.
  if (c.phone && (!customer || customer.phone !== c.phone)) {
    customer = await input.resolveCustomer(c.phone);
    if (customer) {
      c.returning = true;
      if (!c.customerName && customer.fullName) c.customerName = customer.fullName;
    }
  }

  // 4. Questions that aren't about booking get a straight answer, then we carry on.
  if (STATUS_INTENT.test(lower) && !c.complaint) {
    intent = "status";
    ack = "For an update on a car that's already with us, the shop will text you from this number — I've flagged it for them. ";
  } else if (PRICE_INTENT.test(lower)) {
    intent = "question";
    ack = "I can't quote from here — the shop looks at the car first and confirms the price with you before any work. ";
  }

  // 5. The next question, or the booking.
  const missing = missingFields(c);
  const first = firstName(c.customerName);
  const lead = safetyWarning ? `${safetyWarning} ` : ack;

  if (missing.length === 0) {
    c.pending = null;
    return {
      reply: `${lead}Thanks${first ? `, ${first}` : ""}. Let me find the earliest opening for ${vehicleLabel(c)}.`,
      intent,
      missing,
      readyToBook: true,
      safetyWarning,
      collected: c,
      customer,
      source: "fallback",
    };
  }

  const next = missing[0];
  const retry = count(c.asked, next) > 0 && c.pending === next;
  c.asked[next] = count(c.asked, next) + 1;
  let question: string;

  switch (next) {
    case "customerName":
      question = retry
        ? "Sorry, I didn't catch that — what name should the booking be under?"
        : `${c.complaint ? "" : "Happy to get you booked in. "}Who am I speaking with?`;
      c.pending = "customerName";
      break;
    case "phone":
      question = retry
        ? "I need a mobile number to hold the booking — ten digits is fine."
        : `${first ? `Thanks, ${first}. ` : ""}What's the best mobile number for you? The confirmation goes there.`;
      c.pending = "phone";
      break;
    case "vehicle": {
      const onFile = customer?.vehicles ?? [];
      if (!retry && onFile.length === 1) {
        c.offered = onFile;
        c.pending = "vehicleConfirm";
        question = `${c.returning && first ? `Welcome back, ${first}. ` : ""}Is this for the ${onFile[0].label}?`;
      } else if (!retry && onFile.length > 1) {
        c.offered = onFile;
        c.pending = "vehicle";
        const list = onFile.map((v) => `the ${v.label}`);
        question = `${c.returning && first ? `Welcome back, ${first}. ` : ""}Which vehicle is it — ${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}?`;
      } else {
        c.pending = "vehicle";
        question = retry
          ? "What's the make and model, and roughly what year?"
          : "What's the vehicle — year, make and model?";
      }
      break;
    }
    case "complaint":
      question = retry
        ? "In a few words, what would you like the shop to look at?"
        : `What's going on with ${vehicleLabel(c)}?`;
      c.pending = "complaint";
      break;
    case "preferredTime":
    default:
      question = "When suits you — any particular day, and morning or afternoon? I'll find the earliest opening that fits.";
      c.pending = "preferredTime";
      break;
  }

  return {
    reply: `${lead}${question}`,
    intent,
    missing,
    readyToBook: false,
    safetyWarning,
    collected: c,
    customer,
    source: "fallback",
  };
}

// -----------------------------------------------------------------------------
// The model
// -----------------------------------------------------------------------------

const TurnSchema = z.object({
  reply: z.string(),
  intent: z.enum(["book", "status", "question", "other"]),
  collected: z.object({
    customerName: z.string().nullable(),
    phone: z.string().nullable(),
    vehicleYear: z.number().int().nullable(),
    vehicleMake: z.string().nullable(),
    vehicleModel: z.string().nullable(),
    complaint: z.string().nullable(),
    preferredTime: z.string().nullable(),
    urgency: z.enum(URGENCIES).nullable(),
  }),
  missing: z.array(z.enum(["customerName", "phone", "vehicle", "complaint", "preferredTime"])),
  readyToBook: z.boolean(),
  safetyWarning: z.string().nullable(),
});

function systemPrompt(shop: TurnInput["shop"], channel: Channel): string {
  return [
    `You are ZOL, the receptionist for ${shop.name}, an independent auto repair shop. You are talking with a customer over ${channel === "voice" ? "the phone" : channel === "sms" ? "text message" : "web chat"}.`,
    "Your only job is to book the vehicle in. Collect: the caller's name, a mobile number, the vehicle (year, make, model), what's wrong in their own words, and when they'd like to come in.",
    "",
    "Rules:",
    "- One question per reply. Short, warm, plain English. No exclamation marks, no emoji, no lists.",
    "- Never diagnose, never guess a cause, never quote a price or a time estimate for the repair. If asked what it costs, say the shop looks at the car first and confirms the price before any work.",
    "- Safety: if the caller describes a flashing warning light, smoke, steam, brake failure, steering failure or anything unsafe, tell them plainly not to drive it and to have it towed in — then keep collecting the booking details. Put that sentence in safetyWarning as well.",
    "- A returning customer (knownCustomer is set) does not need to repeat their name or number. Offer the vehicle on file; if there are several, ask which.",
    "- Carry forward everything already in `collected`; add what the customer just told you. Phone numbers as +1XXXXXXXXXX.",
    "- readyToBook is true only when name, phone, vehicle make and complaint are all known. Then say you are finding the earliest opening — do not state a day or time; the booking system does that.",
    "- If the caller is asking about a car already in the shop (status), say the shop will text them an update and set intent to status.",
    shop.phone ? `- The shop's number, if the caller asks, is ${shop.phone}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function replyForTurn(input: TurnInput): Promise<TurnResult> {
  const result = await structuredCompletion({
    name: "receptionist_turn",
    schema: TurnSchema,
    system: systemPrompt(input.shop, input.channel),
    history: input.history
      .filter((line) => line.role !== "system")
      .map((line) => ({
        role: line.role === "customer" ? ("user" as const) : ("assistant" as const),
        content: line.content,
      })),
    input: {
      knownCustomer: input.customer
        ? { name: input.customer.fullName, vehicles: input.customer.vehicles.map((v) => v.label) }
        : null,
      collected: {
        customerName: input.collected.customerName,
        phone: input.collected.phone,
        vehicle: input.collected.vehicle,
        complaint: input.collected.complaint,
        preferredTime: input.collected.preferredTime,
        urgency: input.collected.urgency,
      },
      customerSays: input.latest,
    },
    temperature: 0.3,
    timeoutMs: 12_000,
  });

  if (!result) return fallbackTurn(input);

  const ai = result.data;
  const c: Collected = { ...input.collected, vehicle: { ...input.collected.vehicle }, asked: { ...input.collected.asked } };
  let customer = input.customer;

  if (ai.collected.customerName) c.customerName = ai.collected.customerName;
  if (ai.collected.phone) {
    const phone = toE164(ai.collected.phone);
    if (phone) c.phone = phone;
  }
  if (ai.collected.vehicleMake) {
    const changed =
      ai.collected.vehicleMake !== c.vehicle.make || ai.collected.vehicleModel !== c.vehicle.model;
    c.vehicle = {
      year: ai.collected.vehicleYear ?? c.vehicle.year,
      make: ai.collected.vehicleMake,
      model: ai.collected.vehicleModel ?? c.vehicle.model,
    };
    if (changed) c.vehicleId = null;
  }
  if (ai.collected.complaint) c.complaint = ai.collected.complaint;
  if (ai.collected.preferredTime) c.preferredTime = ai.collected.preferredTime;

  // The keyword classifier is a floor under the model's judgement of urgency.
  c.urgency = maxUrgency(maxUrgency(c.urgency, ai.collected.urgency ?? "routine"), classifyUrgency(input.latest));
  for (const s of symptomsIn(input.latest)) if (!c.symptoms.includes(s)) c.symptoms.push(s);
  if (c.complaint && !c.serviceType) c.serviceType = serviceTypeFor(`${c.complaint} ${input.latest}`);
  c.pending = null;
  c.offered = [];

  if (c.phone && (!customer || customer.phone !== c.phone)) {
    customer = await input.resolveCustomer(c.phone);
    if (customer) {
      c.returning = true;
      if (!c.customerName && customer.fullName) c.customerName = customer.fullName;
      // A returning customer with one car and no other car mentioned: that's the one.
      if (!c.vehicle.make && customer.vehicles.length === 1) {
        const v = customer.vehicles[0];
        c.vehicle = { year: v.year, make: v.make, model: v.model };
        c.vehicleId = v.id;
      }
    }
  }

  const required = !c.customerName || !c.phone || (!c.vehicle.make && !c.vehicleId) || !c.complaint;
  const safetyWarning =
    ai.safetyWarning ?? (classifyUrgency(input.latest) === "stop_driving" ? safetyAdviceFor("stop_driving", input.latest) : null);

  /*
    The model said it's ready but a required fact is missing — its reply
    would promise a booking that can't be written. Let the state machine ask
    the right question instead, on the facts the model did collect.
  */
  if (ai.readyToBook && required) {
    return fallbackTurn({ ...input, collected: c, customer });
  }

  return {
    reply: ai.reply,
    intent: ai.intent,
    missing: ai.missing,
    readyToBook: ai.readyToBook && !required,
    safetyWarning,
    collected: c,
    customer,
    source: "openai",
  };
}
