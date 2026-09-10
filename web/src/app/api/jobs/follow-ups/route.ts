import { env } from "@/lib/env";
import { bearerToken, verifyGoogleIdToken } from "@/lib/google-oidc";
import { runFollowUpWorker } from "@/lib/jobs/follow-ups";

export const dynamic = "force-dynamic";

/**
 * Drains the follow-up queue.
 *
 * Cloud Scheduler calls this every five minutes with a Google-signed ID token
 * minted for this exact URL. The same door as the waitlist sweeper, checked
 * the same way: signature, issuer, audience, and an allowlisted caller. The
 * route is a public URL on a public Cloud Run service, so this check is the
 * whole of what stands between the internet and texting a shop's customers.
 *
 * Fails closed. A deploy without JOBS_AUDIENCE or
 * JOBS_SCHEDULER_SERVICE_ACCOUNT sends nothing at all; the queue simply
 * waits, and the CRM's "due now" count says so.
 */

function deny(reason: string) {
  console.warn("[follow-ups] rejected caller:", reason);
  // Nothing about *why* goes back over the wire.
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const audience = env.jobs.audience;
  const account = env.jobs.schedulerServiceAccount;

  if (!audience) return deny("JOBS_AUDIENCE is not set");
  if (!account) return deny("JOBS_SCHEDULER_SERVICE_ACCOUNT is not set");

  const token = bearerToken(request);
  if (!token) return deny("no bearer token");

  const check = await verifyGoogleIdToken(token, audience, account.split(","));
  if (!check.ok) return deny(check.reason);

  let summary;
  try {
    summary = await runFollowUpWorker({ limit: 50 });
  } catch (error) {
    console.error("[follow-ups] run failed", error);
    return Response.json({ error: "Queue unavailable" }, { status: 503 });
  }

  /*
    200 even when individual rows failed: the run itself happened, and a
    failed row is a retry (or a notification to the shop), not a broken job.
    A non-2xx would make the scheduler retry the whole batch on top of the
    schedule it was already going to run.
  */
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
