/**
 * Server-side configuration. Helpers throw at call time, not import time, so
 * a missing key breaks the request that needs it rather than the build.
 *
 * This file is imported by both the Next.js routes and the custom WebSocket
 * server (server.ts), so it must stay free of Next-only imports.
 */

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value;
}

export const env = {
  /** Public HTTPS origin Twilio reaches us on, e.g. https://zol-support-xyz.a.run.app */
  publicBaseUrl: () => required("PUBLIC_BASE_URL").replace(/\/$/, ""),

  twilioAccountSid: () => required("TWILIO_ACCOUNT_SID"),
  twilioAuthToken: () => required("TWILIO_AUTH_TOKEN"),
  twilioPhoneNumber: () => required("TWILIO_PHONE_NUMBER"),

  openaiApiKey: () => required("OPENAI_API_KEY"),
  openaiRealtimeModel: () => optional("OPENAI_REALTIME_MODEL") ?? "gpt-realtime",
  openaiVoice: () => optional("OPENAI_VOICE") ?? "marin",
  openaiSummaryModel: () => optional("OPENAI_SUMMARY_MODEL") ?? "gpt-4o-mini",

  databaseUrl: () => optional("DATABASE_URL"),

  /** Number a caller is forwarded to when they ask for a human. Optional until set. */
  handoffNumber: () => optional("HANDOFF_PHONE_NUMBER"),

  /** Set to "true" to skip Twilio signature checks (local tunnels only). */
  skipTwilioSignature: () => optional("SKIP_TWILIO_SIGNATURE")?.toLowerCase() === "true",
};
