import "server-only";

import { z } from "zod";

import { describeItem, ratedOnly } from "@/lib/inspections";
import type { Rating } from "@/lib/statuses";
import { structuredCompletion } from "./client";

/**
 * The customer-facing summary of a digital inspection.
 *
 * Grounded, by construction, in the items the technician actually rated:
 * the model is handed those and nothing else, and the fallback is a plain
 * restatement of the red and yellow ones. A summary that mentions a system
 * nobody looked at is the one thing this must never produce — a customer
 * who reads "your transmission is fine" when the tech never opened the hood
 * on it has been lied to by software.
 *
 * Buckets follow what a service advisor says at the counter: what needs
 * doing now, what to plan for, routine maintenance, and anything that is a
 * safety matter regardless of colour.
 */

export const InspectionSummarySchema = z.object({
  /** Two or three plain sentences a customer reads first. */
  summary: z.string().min(1).max(600),
  /** Red items: needs attention now. */
  urgent: z.array(z.string().max(200)).max(13),
  /** Yellow items: plan for it soon. */
  recommended: z.array(z.string().max(200)).max(13),
  /** Routine items the visit turned up — filters, wipers, fluids. */
  maintenance: z.array(z.string().max(200)).max(13),
  /** Anything safety-related, whatever its colour: brakes, tires, steering, lights. */
  safety: z.array(z.string().max(200)).max(13),
});

export type InspectionSummary = z.infer<typeof InspectionSummarySchema>;

export interface SummaryItem {
  category: string;
  name: string;
  rating: Rating;
  notes: string | null;
  measurement: string | null;
}

export interface SummaryOutcome {
  summary: InspectionSummary;
  source: "openai" | "fallback";
  model?: string;
}

/** Systems whose yellow or red is a safety matter, not just a recommendation. */
const SAFETY_CATEGORIES = new Set(["Brakes", "Tires", "Steering", "Suspension", "Lights", "Safety"]);

/** Systems where a yellow is routine upkeep rather than a repair. */
const MAINTENANCE_CATEGORIES = new Set(["Fluids", "Exterior", "Interior", "Heating & A/C"]);

/**
 * The deterministic summary. Only red and yellow items appear; green items
 * are counted, not listed, because "your horn works" is noise on a phone.
 */
export function fallbackSummary(items: readonly SummaryItem[]): InspectionSummary {
  const rated = ratedOnly(items);
  const red = rated.filter((item) => item.rating === "red");
  const yellow = rated.filter((item) => item.rating === "yellow");
  const green = rated.filter((item) => item.rating === "green");

  const urgent = red.map(describeItem);
  const recommended = yellow
    .filter((item) => !MAINTENANCE_CATEGORIES.has(item.category))
    .map(describeItem);
  const maintenance = yellow
    .filter((item) => MAINTENANCE_CATEGORIES.has(item.category))
    .map(describeItem);
  const safety = [...red, ...yellow]
    .filter((item) => SAFETY_CATEGORIES.has(item.category))
    .map(describeItem);

  const sentences: string[] = [];
  if (rated.length === 0) {
    sentences.push("No systems were rated on this inspection.");
  } else {
    sentences.push(
      `We checked ${rated.length} ${rated.length === 1 ? "system" : "systems"}${
        green.length > 0 ? ` and ${green.length} ${green.length === 1 ? "is" : "are"} in good shape` : ""
      }.`,
    );
    if (red.length > 0) {
      sentences.push(
        `${red.length === 1 ? "One item needs" : `${red.length} items need`} attention now: ${red
          .map((item) => item.category.toLowerCase())
          .join(", ")}.`,
      );
    }
    if (yellow.length > 0) {
      sentences.push(
        `${yellow.length === 1 ? "One item is" : `${yellow.length} items are`} worth planning for soon: ${yellow
          .map((item) => item.category.toLowerCase())
          .join(", ")}.`,
      );
    }
    if (red.length === 0 && yellow.length === 0) {
      sentences.push("Nothing needs doing beyond routine service.");
    }
  }

  return { summary: sentences.join(" "), urgent, recommended, maintenance, safety };
}

const SYSTEM = [
  "You are a service advisor at an independent auto repair shop writing the customer-facing summary of a",
  "digital vehicle inspection. You are given only the items the technician rated, with their rating",
  "(green = good, yellow = watch, red = urgent), notes and measurements.",
  "",
  "Write `summary` as two or three short plain sentences a customer reads on their phone: what was checked,",
  "what is fine, what needs attention. No marketing voice, no exclamation marks, no jargon without a plain",
  "gloss. Put each red item in `urgent`, each yellow item in `recommended` or `maintenance` (maintenance for",
  "routine upkeep like wipers, filters and fluids), and repeat any brake, tire, steering, suspension, light or",
  "safety-system item that is yellow or red in `safety`. Each list entry is one short phrase naming the system",
  "and the finding, with the measurement when there is one.",
  "",
  "Mention only systems in the input. Never invent a finding, a measurement or a recommendation, and never",
  "name a price.",
].join("\n");

/**
 * Summarise. The model gets only rated items; the fallback builds the same
 * shape from the red and yellow ones. Both are labelled by `source`.
 */
export async function summarize(items: readonly SummaryItem[]): Promise<SummaryOutcome> {
  const rated = ratedOnly(items);
  if (rated.length === 0) {
    return { summary: fallbackSummary(items), source: "fallback" };
  }

  const completion = await structuredCompletion({
    name: "inspection_summary",
    schema: InspectionSummarySchema,
    system: SYSTEM,
    input: {
      items: rated.map((item) => ({
        category: item.category,
        checked: item.name,
        rating: item.rating,
        notes: item.notes,
        measurement: item.measurement,
      })),
    },
  });

  if (!completion) {
    return { summary: fallbackSummary(items), source: "fallback" };
  }
  return { summary: completion.data, source: "openai", model: completion.model };
}
