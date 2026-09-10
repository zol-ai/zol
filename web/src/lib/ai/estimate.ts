import "server-only";

import { z } from "zod";

import { structuredCompletion } from "./client";
import { formatCents } from "@/lib/money";

/**
 * The plain-English note above the lines on an estimate.
 *
 * The customer opens the estimate on a phone, in a car park, and the first
 * thing they read decides whether they tap Approve or call the shop confused.
 * The model is asked to turn what the technician actually found into two or
 * three sentences a non-mechanic follows — and nothing else. It is handed the
 * lines with the shop's prices already on them and told the prices are not
 * its business; it names the work, it never invents a number.
 *
 * Without a key, or when the call fails, the template below says the same
 * things more plainly. The advisor edits either one before it goes out.
 */

const NoteSchema = z.object({
  /** Two to four short sentences: what was found, what the work does, why now. */
  explanation: z.string().min(20).max(900),
  /** One sentence on what happens if more is found once the work starts. */
  disclaimer: z.string().min(10).max(300),
});

export type EstimateNote = z.infer<typeof NoteSchema>;

export interface EstimateNoteInput {
  shopName: string;
  /** "2014 Jeep Compass", or null. */
  vehicle: string | null;
  /** What the customer reported, in their words. */
  complaint: string | null;
  /** Only the technician's own verified finding — never the model's ranking. */
  diagnosis: { codes: string[]; verification: string } | null;
  /** The completed inspection's customer summary, if there is one. */
  inspectionSummary: string | null;
  lines: {
    kind: string;
    description: string;
    quantity: number;
    unitCents: number;
    totalCents: number;
  }[];
}

export interface EstimateNoteResult extends EstimateNote {
  source: "openai" | "fallback";
}

const SYSTEM = [
  "You write the customer-facing note at the top of an auto repair estimate for an independent shop.",
  "Audience: the vehicle's owner, reading on a phone. No jargon without a plain-words gloss, no marketing voice, no exclamation marks.",
  "Explain what the technician found and what the listed work does about it, in two to four short sentences.",
  "Use only the facts supplied: the complaint, the technician's verified diagnosis, the inspection summary and the line items.",
  "Never state, estimate or compare prices. The shop sets prices and they are shown separately on the estimate.",
  "Never add work, parts or problems that are not in the lines. If the diagnosis is missing, describe the work from the lines alone.",
  "The disclaimer is one sentence: if something else turns up once the work is under way, the shop stops and asks before doing more.",
].join("\n");

/** Just the sentence the customer sees under the lines; kept for the template. */
const FALLBACK_DISCLAIMER =
  "This covers the work listed above. If we find anything else once we're in there, we'll stop and check with you before doing more.";

function fallbackNote(input: EstimateNoteInput): EstimateNote {
  const car = input.vehicle ?? "your vehicle";
  const work = input.lines
    .filter((line) => line.kind === "labor")
    .map((line) => line.description);
  const parts = input.lines.filter((line) => line.kind === "part").map((line) => line.description);

  const sentences: string[] = [];
  if (input.complaint) {
    sentences.push(`You brought ${car} in for: ${trimSentence(input.complaint)}`);
  }
  if (input.diagnosis?.verification) {
    sentences.push(`What we found: ${trimSentence(input.diagnosis.verification)}`);
  } else if (input.inspectionSummary) {
    sentences.push(trimSentence(input.inspectionSummary));
  }
  if (work.length > 0) {
    sentences.push(`The work we're recommending is ${joinList(work)}.`);
  } else if (parts.length > 0) {
    sentences.push(`This estimate covers ${joinList(parts)}.`);
  } else if (input.lines.length > 0) {
    sentences.push(`This estimate covers ${joinList(input.lines.map((line) => line.description))}.`);
  }
  if (parts.length > 0 && work.length > 0) {
    sentences.push(`Parts needed: ${joinList(parts)}.`);
  }
  sentences.push(
    `Prices are ${input.shopName}'s own rates for parts and labour; tax is shown separately. Approve or decline each line below, or call us with any questions.`,
  );

  return { explanation: sentences.join(" "), disclaimer: FALLBACK_DISCLAIMER };
}

function trimSentence(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function joinList(items: string[]): string {
  const lower = items.map((item) => item.trim());
  if (lower.length <= 1) return lower[0] ?? "";
  if (lower.length === 2) return `${lower[0]} and ${lower[1]}`;
  return `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}

export async function draftEstimateNote(input: EstimateNoteInput): Promise<EstimateNoteResult> {
  const result = await structuredCompletion({
    name: "estimate_note",
    schema: NoteSchema,
    system: SYSTEM,
    input: {
      shop: input.shopName,
      vehicle: input.vehicle,
      complaint: input.complaint,
      verifiedDiagnosis: input.diagnosis,
      inspectionSummary: input.inspectionSummary,
      // Prices ride along formatted so the model can't mistake cents for
      // dollars if it ignores the instruction — but it is told not to use them.
      lines: input.lines.map((line) => ({
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        price: formatCents(line.totalCents),
      })),
    },
    temperature: 0.3,
    timeoutMs: 15_000,
  });

  if (result) return { ...result.data, source: "openai" };
  return { ...fallbackNote(input), source: "fallback" };
}

/** The two parts as one stored note: explanation, blank line, disclaimer. */
export function composeNote(note: EstimateNote): string {
  return `${note.explanation.trim()}\n\n${note.disclaimer.trim()}`;
}
