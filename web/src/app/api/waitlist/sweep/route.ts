import { pushWaitlistEntryToCompanyBrain } from "@/lib/company-brain";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { bearerToken, verifyGoogleIdToken } from "@/lib/google-oidc";
import type { WaitlistEntry } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

/**
 * Delivers waitlist entries to Company OS.
 *
 * Cloud Scheduler calls this every five minutes. Nothing else does, and no
 * other code path in this application POSTs to Company OS — moving delivery
 * out of the submission path is what makes a failed delivery a delay rather
 * than a lost lead.
 *
 * Undelivered rows are the queue. There is no retry table and no backoff: a
 * row either has `delivered_at` or it goes again in five minutes. The receiver
 * deduplicates on `${event_id}:${revision}`, so a redelivery of something that
 * already landed is a 200 and a no-op.
 *
 * The endpoint is public — Cloud Run serves it to the internet — so the token
 * check below is the only thing standing in front of it.
 */

interface Outcome {
  event: string;
  status: "delivered" | "rejected" | "failed";
  detail?: string;
}

function deny(reason: string) {
  console.warn("[sweep] rejected caller:", reason);
  // Nothing about *why* goes back over the wire. A caller probing this
  // endpoint learns only that it did not work.
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const audience = env.companyOs.sweepAudience;
  const account = env.companyOs.schedulerServiceAccount;

  /*
    Fail closed on missing configuration. A deploy without these variables
    should deliver nothing at all rather than accept anonymous requests to a
    URL that reads the lead table and talks to another service.
  */
  if (!audience) return deny("COMPANY_OS_SWEEP_AUDIENCE is not set");
  if (!account) return deny("COMPANY_OS_SCHEDULER_SERVICE_ACCOUNT is not set");

  const token = bearerToken(request);
  if (!token) return deny("no bearer token");

  const check = await verifyGoogleIdToken(token, audience, account.split(","));
  if (!check.ok) return deny(check.reason);

  const { sweepWindowDays, sweepBatchSize } = env.companyOs;

  let rows: WaitlistEntry[];
  try {
    /*
      Oldest first, so a backlog drains in the order it arrived, and bounded so
      one invocation cannot run past Cloud Run's request timeout. Whatever is
      left over is picked up by the next sweep five minutes later — the batch
      size bounds one request, not the queue.

      The window matches the partial index on (created_at) WHERE
      delivered_at IS NULL.
    */
    rows = await query<WaitlistEntry>(
      `SELECT * FROM waitlist_entries
        WHERE delivered_at IS NULL
          AND created_at > now() - ($1 || ' days')::interval
        ORDER BY created_at
        LIMIT $2`,
      [String(sweepWindowDays), sweepBatchSize],
    );
  } catch (error) {
    console.error("[sweep] could not read the queue", error);
    return Response.json({ error: "Queue unavailable" }, { status: 503 });
  }

  const outcomes: Outcome[] = [];

  /*
    Sequential, deliberately.

    The batch is small, the receiver is a single Cloud Run service, and a
    parallel fan-out of fifty writes at a service sized for two people using a
    dashboard is how a delivery sweep turns into an outage. Latency does not
    matter here — nothing is waiting on this.
  */
  for (const entry of rows) {
    const event = `${entry.event_id}:${entry.revision}`;
    const result = await pushWaitlistEntryToCompanyBrain(entry);

    if (result.status === "delivered") {
      try {
        /*
          Guarded on `revision`, not just `id`. If the shop owner resubmitted
          while this row was in flight, the upsert has already bumped the
          revision and cleared delivered_at — and stamping it now would mark
          the *new* version delivered on the strength of the old one having
          been. The correction would never ship. No rows updated is the correct
          outcome there: the next sweep sends the newer revision.
        */
        await query(
          `UPDATE waitlist_entries
              SET delivered_at = now()
            WHERE id = $1 AND revision = $2 AND delivered_at IS NULL`,
          [entry.id, entry.revision],
        );
      } catch (error) {
        /*
          Delivered but unstamped. The row goes again next sweep and the
          receiver discards it as a duplicate, so this costs one redundant
          request and nothing else — which is exactly the failure the
          deduplication key exists to absorb.
        */
        console.error(`[sweep] ${event} delivered but not stamped`, error);
      }
      outcomes.push({ event, status: "delivered" });
      continue;
    }

    if (result.status === "rejected") {
      /*
        The receiver says this payload is wrong, and it will still be wrong in
        five minutes. Left undelivered on purpose: the row stays visible in the
        queue as something needing a person, rather than being stamped to make
        the count look clean.
      */
      console.error(
        `[sweep] ${event} rejected with ${result.code}: ${result.detail}`,
      );
      outcomes.push({ event, status: "rejected", detail: result.detail });
      continue;
    }

    console.warn(`[sweep] ${event} failed, will retry: ${result.detail}`);
    outcomes.push({ event, status: "failed", detail: result.detail });
  }

  const delivered = outcomes.filter((o) => o.status === "delivered").length;
  const rejected = outcomes.filter((o) => o.status === "rejected").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;

  console.info(
    `[sweep] ${rows.length} considered, ${delivered} delivered, ` +
      `${rejected} rejected, ${failed} failed`,
  );

  /*
    200 even when individual rows failed. The sweep itself ran; a failed row is
    a retry, not a broken job, and returning non-2xx would make Cloud Scheduler
    retry the whole batch on top of the schedule that was already going to.

    `truncated` says the batch filled up, so somebody reading the logs can tell
    a five-minute drain from a backlog that is not keeping up.
  */
  return Response.json(
    {
      considered: rows.length,
      delivered,
      rejected,
      failed,
      truncated: rows.length === sweepBatchSize,
      outcomes,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
