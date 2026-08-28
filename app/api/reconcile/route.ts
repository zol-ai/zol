import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowedReconcileServiceAccounts,
  verifyServiceCaller,
} from "@/lib/auth/serviceIdentity";
import { getSessionUser } from "@/lib/auth/session";
import { reconcileWaitlist } from "@/lib/reconcile";

export const dynamic = "force-dynamic";

/**
 * Triggers a reconciliation run against tryzol.com's waitlist queue.
 *
 * Two kinds of caller, because there are two ways this gets used: a person
 * settling a suspicion that something did not arrive, and a scheduler doing it
 * on a slow cadence. So a signed session **or** an allowlisted service account
 * gets in, and the two are checked in that order.
 *
 * Deliberately not on a tight loop. A run replays rows that have already been
 * applied — cheap, but not free — and the push path is what delivers in the
 * ordinary case. This is the safety net, not the mechanism.
 *
 * The work itself never touches Firestore directly; see `lib/reconcile.ts`.
 */

const optionsSchema = z
  .object({
    since: z.string().datetime({ offset: true }).optional(),
    cursor: z.string().min(1).max(512).optional(),
    pageSize: z.number().int().min(1).max(500).optional(),
    maxPages: z.number().int().min(1).max(200).optional(),
    /** Capped under Cloud Run's ceiling; the job needs to outlive its pages. */
    budgetMs: z.number().int().min(10_000).max(3_300_000).optional(),
  })
  .strict()
  .default({});

export async function POST(request: Request) {
  /*
    A person first. `getSessionUser` already re-checks ALLOWED_EMAILS on every
    call, so a removed user is refused here on their next request even if they
    still hold a cookie.
  */
  const user = await getSessionUser();

  let actor: string;
  if (user) {
    actor = user.email;
  } else {
    const service = await verifyServiceCaller(
      request,
      allowedReconcileServiceAccounts(),
    );
    if (!service.ok) {
      console.warn("[reconcile] rejected caller:", service.reason);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    actor = service.email;
  }

  /*
    An empty body is the ordinary case — "reconcile everything" — so it is not
    an error. Anything present is parsed strictly, because a misspelled option
    that silently defaults would make a run look complete when it covered a
    different range than intended.
  */
  let options;
  try {
    const text = await request.text();
    options = optionsSchema.parse(text.trim() ? JSON.parse(text) : undefined);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid options", issues: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Body was not JSON" }, { status: 400 });
  }

  try {
    const report = await reconcileWaitlist(options);
    /*
      The error sample goes into the log, not only the response body. The
      scheduled run is the primary caller and Cloud Scheduler throws response
      bodies away — a failure diagnosable only from a body nobody keeps is not
      diagnosable at all.
    */
    console.info(
      `[reconcile] ${actor}: ${report.pages} pages, ${report.fetched} fetched, ` +
        `${report.created} created, ${report.merged} merged, ` +
        `${report.duplicates} already applied, ${report.failed} failed` +
        (report.truncated ? " (truncated — resume with nextCursor)" : "") +
        (report.errors.length ? ` — ${report.errors.join("; ")}` : "") +
        (report.suppressedErrors ? ` (+${report.suppressedErrors} more)` : ""),
    );
    return NextResponse.json(report);
  } catch (error) {
    console.error("[reconcile] run failed", error);
    const message = error instanceof Error ? error.message : "Reconciliation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
