import "server-only";

import OpenAI from "openai";

let client: OpenAI | undefined;

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Company Brain is not configured. Add OPENAI_API_KEY to the server environment.",
    );
  }
  client ??= new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
  return client;
}

export function getCompanyBrainModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-5.5";
}
