import "server-only";

/**
 * Server-side configuration. Nothing here is ever imported into a client
 * component — the `server-only` guard turns that into a build error rather
 * than a leaked key.
 */

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/** Throws at call time, not import time, so a missing key can't break the build. */
function required(name: string): string {
  const value = optional(name);
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

function flag(name: string): boolean {
  return optional(name)?.toLowerCase() === "true";
}

export const env = {
  /**
   * Telephony stays off until Twilio's carrier registration (A2P 10DLC brand
   * and campaign vetting, plus the voice CNAM/toll-free steps) is approved.
   * Until this is `true` the webhooks refuse to transact — failing closed is
   * the point: an unregistered number that answers calls is the compliance
   * problem we're waiting to clear.
   */
  telephonyEnabled: flag("ZOL_TELEPHONY_ENABLED"),

  twilio: {
    /** Used to verify that a webhook genuinely came from Twilio. */
    get authToken() {
      return required("TWILIO_AUTH_TOKEN");
    },
    get accountSid() {
      return required("TWILIO_ACCOUNT_SID");
    },
    /** The shop-facing number, once a registered one exists. */
    phoneNumber: optional("TWILIO_PHONE_NUMBER"),
  },

  openai: {
    get apiKey() {
      return required("OPENAI_API_KEY");
    },
    /** Overridable so a model swap is a deploy, not a code change. */
    model: optional("OPENAI_MODEL") ?? "gpt-4o",
    transcribeModel: optional("OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1",
  },

  database: {
    url: optional("DATABASE_URL"),
    /**
     * `project:region:instance`. When set, `lib/db.ts` dials Cloud SQL through
     * the Node connector instead of `url` — the only path that works from
     * Vercel, whose egress IP changes too often to allowlist.
     */
    instanceConnectionName: optional("INSTANCE_CONNECTION_NAME"),
    get configured() {
      return Boolean(this.url ?? this.instanceConnectionName);
    },
  },

  /**
   * Public origin, used to rebuild the exact URL Twilio signed. Behind Cloud
   * Run and Vercel the request host can be a proxy host, and a mismatch here
   * silently fails every signature check.
   */
  publicUrl: optional("ZOL_PUBLIC_URL"),
} as const;
