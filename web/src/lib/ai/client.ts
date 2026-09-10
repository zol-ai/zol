import "server-only";

import { z } from "zod";

import { env } from "@/lib/env";

/**
 * One way of asking the model for a shape.
 *
 * Every AI feature in the product — diagnostics, the inspection summary, the
 * estimate wording, follow-up drafts, the receptionist — is "here are facts,
 * give me JSON of this exact shape". So there is one function for that, and
 * two rules it enforces for everyone:
 *
 *   1. The result is parsed with the caller's zod schema before anyone sees
 *      it. The model is asked for the shape (json_schema response format,
 *      derived from the same zod schema) but never trusted to have produced
 *      it; a parse failure is a null, not a crash and not a half-shaped
 *      object leaking into the database.
 *
 *   2. No key, a timeout, a 5xx, a parse failure — all of them return null,
 *      and the caller falls back to something deterministic and labelled.
 *      No screen in this product goes blank because OpenAI had a bad minute.
 *
 * Plain fetch, no SDK, matching lib/agent/diagnose.ts.
 */

export interface StructuredRequest<T> {
  /** Names the schema in the request; shows up in OpenAI's logs. snake_case. */
  name: string;
  schema: z.ZodType<T>;
  system: string;
  /** Serialised as JSON into the user turn. */
  input: unknown;
  temperature?: number;
  timeoutMs?: number;
  /** Prior turns, for conversational callers. Appended before `input`. */
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface StructuredResult<T> {
  data: T;
  source: "openai";
  model: string;
}

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function structuredCompletion<T>(
  request: StructuredRequest<T>,
): Promise<StructuredResult<T> | null> {
  if (!aiConfigured()) return null;

  const jsonSchema = z.toJSONSchema(request.schema, { target: "draft-7" });

  const messages = [
    {
      role: "system",
      content:
        request.system +
        "\n\nAnswer with a single JSON object matching the schema. Use only the facts you are given; never invent a vehicle problem, a measurement, a part number or a price.",
    },
    ...(request.history ?? []),
    { role: "user", content: JSON.stringify(request.input) },
  ];

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.openai.model,
        temperature: request.temperature ?? 0.2,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: request.name, schema: jsonSchema },
        },
      }),
      signal: AbortSignal.timeout(request.timeoutMs ?? 25_000),
    });
  } catch (error) {
    console.warn(`[ai:${request.name}] request failed`, error);
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn(`[ai:${request.name}] HTTP ${response.status}: ${detail.slice(0, 300)}`);
    return null;
  }

  const payload = (await response.json().catch(() => null)) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
  } | null;

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    console.warn(`[ai:${request.name}] returned non-JSON content`);
    return null;
  }

  const parsed = request.schema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[ai:${request.name}] shape mismatch`, parsed.error.issues.slice(0, 3));
    return null;
  }

  return { data: parsed.data, source: "openai", model: payload?.model ?? env.openai.model };
}
