"use server";

import { answerQuestion, type AssistantReply, type Turn } from "@/lib/ai/assistant";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Ask ZOL.
 *
 * Called directly from the chat component rather than through a form: the
 * transcript lives in the client and each turn is one round trip. The
 * session decides the shop — nothing in the question can point the tools at
 * another tenant, because the tools only ever receive `user.shopId`.
 */

const MAX_QUESTION = 400;
const MAX_HISTORY = 6;

export async function askZol(question: unknown, history: unknown = []): Promise<AssistantReply> {
  const user = await requireUser();

  const asked = typeof question === "string" ? question.replace(/\s+/g, " ").trim() : "";
  if (asked.length < 2) {
    return {
      answer: "Ask me something about the shop — approvals, the schedule, parts, the techs, revenue, a customer or a ticket.",
      links: [],
      source: "fallback",
      tools: [],
    };
  }

  // Prior turns are the client's own transcript, replayed for context. They
  // are text for the model, never instructions for the tools, and they are
  // bounded so a long session can't grow the request without limit.
  const turns: Turn[] = Array.isArray(history)
    ? history
        .filter(
          (turn): turn is Turn =>
            typeof turn === "object" &&
            turn !== null &&
            typeof (turn as Turn).question === "string" &&
            typeof (turn as Turn).answer === "string",
        )
        .slice(-MAX_HISTORY)
        .map((turn) => ({
          question: turn.question.slice(0, MAX_QUESTION),
          answer: turn.answer.slice(0, 1500),
        }))
    : [];

  return answerQuestion(
    await db(),
    { shopId: user.shopId, shopName: user.shopName, timezone: user.timezone },
    asked.slice(0, MAX_QUESTION),
    turns,
  );
}
