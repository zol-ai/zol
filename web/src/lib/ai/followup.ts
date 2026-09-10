import "server-only";

import { z } from "zod";

import { structuredCompletion } from "./client";
import { journeyMessage } from "../follow-ups";
import { formatPhone } from "../phone";
import type { FollowUpKind } from "../statuses";

/**
 * A drafted follow-up message, from verified facts only.
 *
 * The CRM card has a "Draft with AI" button. What it hands the model is the
 * short list below — things the shop already knows to be true about this
 * customer and this follow-up — and what it gets back is a text message the
 * advisor can read, edit and send. The draft is stored on the row as
 * `ai_draft` and is never sent on its own: a person copies it into `body`.
 *
 * Two guarantees, whichever way the draft was made:
 *
 *   * **No invented facts.** The prompt says so, the input carries no prices
 *     or findings beyond what is in the facts, and the result is refused —
 *     falling back to the template — if it contains a dollar amount at all.
 *     The follow-up templates never quote money, so a "$" in the draft can
 *     only have come from the model.
 *   * **Always a draft.** No key, a timeout, a malformed answer: the caller
 *     gets the deterministic template from lib/follow-ups.ts, labelled
 *     `source: "fallback"` so the screen can say so.
 */

export interface FollowUpFacts {
  shopName: string;
  /** E.164, or null when the shop has no public number on file. */
  shopPhone: string | null;
  kind: FollowUpKind;
  customerFirstName: string | null;
  /** "2015 Chevrolet Sonic", or null. */
  vehicle: string | null;
  /** What the CRM card says this follow-up is about. */
  title: string | null;
  details: string | null;
  /** For declined-work and inspection recalls: the work itself. */
  work: string | null;
  /** "Sep 15, 2026", already in the shop's zone, or null if never. */
  lastVisit: string | null;
  roNumber: number | null;
}

export interface FollowUpDraft {
  /** A few words naming the message, for the card. Not sent. */
  subject: string;
  /** The complete text to send, call to action included. */
  message: string;
  /** The ask, in a few words, for the card. */
  callToAction: string;
  source: "openai" | "fallback";
}

const DraftSchema = z.object({
  subject: z.string().min(1).max(80),
  message: z.string().min(1).max(320),
  callToAction: z.string().min(1).max(80),
});

const SYSTEM = `You write short text messages from an independent auto repair shop to one of its customers.

Rules:
- Open with the shop's name so the customer knows who is texting before they read a word.
- Plain, warm and brief. Under 300 characters. No exclamation marks, no emoji, no marketing voice.
- Use only the facts you are given. Never mention a price, a discount, a part number, a measurement or a problem with the vehicle that is not in the facts. If a fact is missing, leave it out rather than guessing.
- End with one clear next step: reply to this text, or call the shop number if one is given.
- "message" is the complete text to send, including that next step. "subject" names the message in a few words for the shop's own screen. "callToAction" repeats the next step in a few words.`;

/**
 * "Rear brake pads at 3mm" → "rear brake pads at 3mm", so the work reads
 * naturally mid-sentence. Left alone when it opens with an acronym (ABS).
 */
export function midSentence(work: string | null): string | null {
  if (!work) return null;
  return /^[A-Z][a-z]/.test(work) ? work.charAt(0).toLowerCase() + work.slice(1) : work;
}

/** The deterministic draft: the same words the journey templates use. */
export function templateDraft(facts: FollowUpFacts): FollowUpDraft {
  const message = journeyMessage(facts.kind, {
    shopName: facts.shopName,
    shopPhone: facts.shopPhone,
    firstName: facts.customerFirstName,
    vehicle: facts.vehicle,
    roNumber: facts.roNumber,
    work: midSentence(facts.work),
  });
  return {
    subject: facts.title ?? message.title,
    message: message.body,
    callToAction: facts.shopPhone
      ? `Reply, or call ${formatPhone(facts.shopPhone)}`
      : "Reply to this text",
    source: "fallback",
  };
}

/** Anything that reads as money. The facts never carry a price, so a draft that does invented one. */
const MONEY = /[$€£]\s?\d|\d\s?(dollars|bucks)\b/i;

export async function draftFollowUp(facts: FollowUpFacts): Promise<FollowUpDraft> {
  const result = await structuredCompletion({
    name: "follow_up_draft",
    schema: DraftSchema,
    system: SYSTEM,
    input: {
      shop: { name: facts.shopName, phone: facts.shopPhone ? formatPhone(facts.shopPhone) : null },
      followUp: {
        kind: facts.kind,
        title: facts.title,
        details: facts.details,
        work: facts.work,
        repairOrderNumber: facts.roNumber,
      },
      customer: {
        firstName: facts.customerFirstName,
        vehicle: facts.vehicle,
        lastVisit: facts.lastVisit,
      },
    },
    temperature: 0.4,
    timeoutMs: 15_000,
  });

  if (!result) return templateDraft(facts);

  const draft = result.data;
  if (MONEY.test(draft.message) || MONEY.test(draft.callToAction)) {
    console.warn("[ai:follow_up_draft] draft mentioned money; using the template instead");
    return templateDraft(facts);
  }

  return { ...draft, source: "openai" };
}
