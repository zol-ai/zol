import { env } from "@/lib/env";
import { messagingStatus } from "@/lib/messaging/provider";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for Cloud Run and uptime checks. Reports which subsystems are
 * configured without ever echoing a secret — only whether one is present.
 */
export function GET() {
  const messaging = messagingStatus();

  return Response.json(
    {
      status: "ok",
      service: "zol-web",
      time: new Date().toISOString(),
      subsystems: {
        telephony: env.telephonyEnabled ? "enabled" : "awaiting-carrier-registration",
        twilioConfigured: env.twilio.configured,
        // Where a customer message actually goes today: "twilio" or the
        // customer's portal page only.
        messaging: messaging.mode,
        openaiConfigured: env.openai.configured,
        stripeConfigured: env.stripe.configured,
        photoStorageConfigured: env.storage.configured,
        followUpWorkerConfigured: Boolean(
          env.jobs.audience && env.jobs.schedulerServiceAccount,
        ),
        // Whether credentials are present, not whether the server answers —
        // that costs a round trip and lives at /api/health/db.
        databaseConfigured: env.database.configured,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
