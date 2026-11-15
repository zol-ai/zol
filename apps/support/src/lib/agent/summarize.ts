import { env } from "../env";
import type { TurnRow } from "../calls";

export type CallAnalysis = { summary: string; intent: string; outcome: string };

const INTENTS = [
  "product_question",
  "join_waitlist",
  "callback_request",
  "existing_customer_support",
  "sales",
  "wrong_number",
  "spam",
  "other",
] as const;

/** One-line summary plus an intent and outcome tag, from the transcript. */
export async function summarizeCall(turns: TurnRow[]): Promise<CallAnalysis | null> {
  if (turns.length === 0) return null;
  const transcript = turns.map((t) => `${t.role}: ${t.content}`).join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openaiApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.openaiSummaryModel(),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Summarize this support call. Reply as JSON with keys: " +
            "summary (one sentence, under 25 words), " +
            `intent (one of: ${INTENTS.join(", ")}), ` +
            "outcome (one of: resolved, callback_requested, waitlist_joined, transferred, abandoned, unclear).",
        },
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!res.ok) {
    console.error("summarizeCall failed", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  try {
    const parsed = JSON.parse(data.choices[0].message.content) as Partial<CallAnalysis>;
    return {
      summary: parsed.summary ?? "",
      intent: parsed.intent ?? "other",
      outcome: parsed.outcome ?? "unclear",
    };
  } catch {
    return null;
  }
}
