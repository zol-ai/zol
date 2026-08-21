import "server-only";
import { env } from "@/lib/env";

/**
 * Turns a call transcript into the three things that go on a repair order:
 * what the customer said, what's probably wrong, and what it costs at this
 * shop's rates.
 *
 * Written against the OpenAI REST API with plain fetch rather than the SDK —
 * one dependency fewer, and the request shape is stable.
 */

export type ShopPricing = {
  laborRateCents: number;
  partsMarginPct: number;
  taxRatePct: number;
  /** Above this, the quote needs a human before it reaches the customer. */
  autoQuoteCapCents: number;
};

export type DiagnosisLine = {
  kind: "labor" | "part";
  description: string;
  /** Book hours for labor, unit count for parts. */
  quantity: number;
  unitCents: number;
};

export type Diagnosis = {
  complaint: string;
  cause: string;
  correction: string;
  lines: DiagnosisLine[];
  /** 0–1. Below ~0.6 we hand the call to a human rather than guess out loud. */
  confidence: number;
  /** Anything the agent needs a person to decide. */
  needsHuman: boolean;
  humanReason?: string;
};

/**
 * Structured-output schema. Constraining the model to this shape is what stops
 * it inventing a price format the rest of the system can't read.
 */
const diagnosisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["complaint", "cause", "correction", "lines", "confidence", "needsHuman"],
  properties: {
    complaint: { type: "string", description: "The customer's own words, cleaned up." },
    cause: { type: "string", description: "Most likely cause. Say so if unsure." },
    correction: { type: "string", description: "The work required to fix it." },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needsHuman: { type: "boolean" },
    humanReason: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "description", "quantity", "unitCents"],
        properties: {
          kind: { type: "string", enum: ["labor", "part"] },
          description: { type: "string" },
          quantity: { type: "number" },
          unitCents: { type: "integer" },
        },
      },
    },
  },
} as const;

function systemPrompt(pricing: ShopPricing): string {
  return [
    "You are the service advisor for an independent auto repair shop.",
    "You are writing up a repair order from a phone call.",
    "",
    "Rules:",
    `- Labor is billed at ${(pricing.laborRateCents / 100).toFixed(2)} per hour. Use standard book times.`,
    `- Parts carry a ${pricing.partsMarginPct}% margin over cost.`,
    "- Quote only work the caller's described symptoms actually justify.",
    "- If the symptoms could mean several things with very different prices, set",
    "  needsHuman to true and explain what needs checking on the vehicle first.",
    "- Never invent a part number, a price you are unsure of, or a diagnosis the",
    "  caller's description does not support. An honest 'we need to look at it'",
    "  is correct and expected in this trade.",
    "- confidence reflects how well the symptoms pin down the cause, not how",
    "  confident you feel writing prose.",
  ].join("\n");
}

export function quoteTotalCents(lines: DiagnosisLine[], pricing: ShopPricing): number {
  const subtotal = lines.reduce(
    (sum, line) => sum + Math.round(line.quantity * line.unitCents),
    0,
  );
  return Math.round(subtotal * (1 + pricing.taxRatePct / 100));
}

/** True when the quote exceeds what the shop lets the agent commit to alone. */
export function needsApproval(totalCents: number, pricing: ShopPricing): boolean {
  return totalCents > pricing.autoQuoteCapCents;
}

export async function diagnoseFromTranscript({
  transcript,
  pricing,
  vehicle,
  signal,
}: {
  transcript: string;
  pricing: ShopPricing;
  /** e.g. "2018 Chevrolet Silverado 1500, 96,412 mi" — improves book times. */
  vehicle?: string;
  signal?: AbortSignal;
}): Promise<Diagnosis> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${env.openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.openai.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt(pricing) },
        {
          role: "user",
          content: [
            vehicle ? `Vehicle: ${vehicle}` : "Vehicle: not identified on the call.",
            "",
            "Call transcript:",
            transcript,
          ].join("\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "diagnosis",
          strict: true,
          schema: diagnosisSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `OpenAI diagnosis failed (${response.status}): ${detail.slice(0, 400)}`,
    );
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("OpenAI diagnosis returned no content");
  }

  return JSON.parse(content) as Diagnosis;
}
