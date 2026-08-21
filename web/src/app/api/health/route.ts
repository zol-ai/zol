import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for Cloud Run and uptime checks. Reports which subsystems are
 * configured without ever echoing a secret — only whether one is present.
 */
export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "zol-web",
      time: new Date().toISOString(),
      subsystems: {
        telephony: env.telephonyEnabled ? "enabled" : "awaiting-carrier-registration",
        twilioConfigured: Boolean(process.env.TWILIO_AUTH_TOKEN),
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        // Whether credentials are present, not whether the server answers —
        // that costs a round trip and lives at /api/health/db.
        databaseConfigured: env.database.configured,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
