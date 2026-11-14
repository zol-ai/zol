import "server-only";

import { GoogleAuth } from "google-auth-library";

import { expectedAudience } from "@/lib/auth/serviceIdentity";
import { eventEnvelopeSchema } from "@/lib/validation/events";

/**
 * Reconciliation: replaying the waitlist queue through the ingest route.
 *
 * Postgres stays the source of truth for waitlist entries; Firestore stays the
 * source of truth for client records. Nothing is duplicated here that the push
 * path was not already copying — this walks tryzol.com's read endpoint and
 * hands each envelope back to our own `POST /api/events`.
 *
 * **It never writes to Firestore.** That is the entire point of routing back
 * through HTTP rather than calling the repository directly: the ingest
 * transaction stays the single writer, with one set of merge rules, one
 * definition of what "already applied" means, and one place where a
 * disagreement becomes a `pendingReview` entry. A reconciliation that wrote
 * its own documents would be a second writer with a second set of rules, which
 * is the thing the single-writer design exists to prevent.
 *
 * Going out over HTTP to our own service is mildly circuitous, and buys the
 * validation, the auth check and the transaction unchanged — the reconciliation
 * path exercises exactly what production runs, rather than something adjacent
 * to it.
 *
 * Idempotent for free. `ingest_events` is keyed on `${event_id}:${revision}`,
 * so a row already applied is a marker hit and a no-op. Replaying the whole
 * queue is safe; it costs one Firestore read per row and changes nothing.
 */

export interface ReconcileOptions {
  /** Only entries updated at or after this ISO timestamp. */
  since?: string;
  /** Resume token from a previous run that stopped at its page ceiling. */
  cursor?: string;
  /** Rows per page requested from tryzol.com. */
  pageSize?: number;
  /**
   * How many pages one run will walk.
   *
   * A ceiling, not a target. This runs inside a request that Cloud Run will
   * eventually time out, so a run that cannot finish should stop and hand back
   * a cursor rather than be killed halfway with nothing to resume from.
   */
  maxPages?: number;
  /**
   * Wall-clock budget for one run, in milliseconds.
   *
   * The page ceiling alone is not enough: pages are counted, but the platform
   * kills requests by the clock, and a slow receiver could burn the whole
   * request timeout inside a page budget that looked conservative. Checked at
   * the page boundary — the one place `cursor` is a valid resume point — so
   * running out of time produces a truncated report with a cursor, not a dead
   * connection with nothing.
   */
  budgetMs?: number;
}

export interface ReconcileReport {
  pages: number;
  fetched: number;
  created: number;
  merged: number;
  duplicates: number;
  failed: number;
  /**
   * The resume point when the run stopped early — page ceiling, time budget,
   * or a page fetch that failed. Null only when the walk genuinely reached the
   * end of the queue.
   */
  nextCursor: string | null;
  /**
   * True whenever the run did not reach the end of the queue. `nextCursor` may
   * still be null in one case: the very first page fetch failed before any
   * cursor existed — resume by rerunning with the original options.
   */
  truncated: boolean;
  /** Bounded sample, so one bad deploy cannot write a novel to the log. */
  errors: string[];
  /** Failures beyond the sample above. Zero means `errors` is the whole story. */
  suppressedErrors: number;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 20;
const MAX_REPORTED_ERRORS = 10;
/**
 * Comfortably inside Cloud Run's default 300s request timeout, leaving room
 * for the page in flight when the budget trips to finish.
 */
const DEFAULT_BUDGET_MS = 240_000;

/**
 * One `GoogleAuth`, reused. Each audience gets its own cached ID-token client,
 * and the client refreshes its own token before expiry — building a new one
 * per page would mean a metadata-server round trip per page for no benefit.
 */
const auth = new GoogleAuth();
const clients = new Map<
  string,
  Promise<Awaited<ReturnType<GoogleAuth["getIdTokenClient"]>>>
>();

function idTokenClient(audience: string) {
  let client = clients.get(audience);
  if (!client) {
    client = auth.getIdTokenClient(audience).catch((error: unknown) => {
      // Don't cache a failed handshake; a transient metadata blip would
      // otherwise poison every run until the instance recycled.
      clients.delete(audience);
      throw error;
    });
    clients.set(audience, client);
  }
  return client;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function reconcileWaitlist(
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const source = requireEnv("WAITLIST_SOURCE_URL").replace(/\/+$/, "");
  /*
    Our own origin, reused as both the destination and the audience the token
    is minted for — the same value `/api/events` checks the `aud` claim
    against. One variable rather than two that must agree.
  */
  const self = expectedAudience();
  if (!self) throw new Error("EVENTS_AUDIENCE is not set");
  const selfBase = self.replace(/\/+$/, "");

  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);

  const report: ReconcileReport = {
    pages: 0,
    fetched: 0,
    created: 0,
    merged: 0,
    duplicates: 0,
    failed: 0,
    nextCursor: null,
    truncated: false,
    errors: [],
    suppressedErrors: 0,
  };

  const recordError = (message: string) => {
    if (report.errors.length < MAX_REPORTED_ERRORS) report.errors.push(message);
    else report.suppressedErrors += 1;
  };

  const reader = await idTokenClient(source);
  const writer = await idTokenClient(self);

  let cursor = options.cursor;
  /*
    Set when the run stops before the end of the queue for any reason — page
    ceiling, time budget, or a failed page fetch. Distinct from `cursor`
    because the first page can fail while `cursor` is still undefined.
  */
  let stoppedEarly = false;

  while (report.pages < maxPages) {
    if (Date.now() >= deadline) {
      stoppedEarly = true;
      break;
    }

    const url = new URL(`${source}/api/waitlist/entries`);
    url.searchParams.set("limit", String(pageSize));
    if (options.since) url.searchParams.set("since", options.since);
    if (cursor) url.searchParams.set("cursor", cursor);

    /*
      Wrapped, because gaxios throws on non-2xx by default and on any transport
      failure — and an unhandled throw here would abort the run and lose the
      cursor with it. A failed page ends the run at a resumable point instead:
      the cursor still names the last completed page.
    */
    let page;
    try {
      page = await reader.request<{
        entries: unknown[];
        next_cursor: string | null;
        count: number;
      }>({ url: url.toString(), method: "GET", timeout: 30_000 });
    } catch (error) {
      recordError(
        `page fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      stoppedEarly = true;
      break;
    }

    report.pages += 1;

    /*
      Assert the shape rather than coercing it. `?? []` here would make a 200
      from the wrong service — a proxy page, a redirect target — look exactly
      like an empty queue, and a clean report from the job whose entire purpose
      is noticing disagreement is the one lie it must not tell.
    */
    const entries = page.data?.entries;
    if (!Array.isArray(entries)) {
      recordError(`unexpected page body from ${source} — not an entries page`);
      stoppedEarly = true;
      break;
    }
    report.fetched += entries.length;

    for (const raw of entries) {
      /*
        Validated against our own envelope schema before being forwarded, even
        though it came from a service we authenticated. The sender lives in
        another repository: authentication says who sent it, not that this
        build and that one still agree about the shape. Catching drift here
        names the field; forwarding it blindly would surface as a 400 from our
        own ingest route, one step further from the cause.
      */
      const parsed = eventEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        report.failed += 1;
        recordError(
          `malformed envelope: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
        );
        continue;
      }

      const envelope = parsed.data;
      const event = `${envelope.event_id}:${envelope.revision}`;

      /*
        Sequential, one outstanding self-request at a time.

        This runs inside one of our own request handlers and calls back into
        the same service. Under Cloud Run's default concurrency there is ample
        room, but a service pinned to concurrency 1 would deadlock — the run
        would hold the only slot while waiting for a request that needs it. One
        at a time keeps the footprint to two slots and makes the failure mode a
        slow run rather than a hung one.
      */
      /*
        validateStatus swallows every HTTP status, but a transport failure —
        timeout, connection reset — still throws, and one bad row must cost
        that row, not the run and its cursor.
      */
      let response;
      try {
        response = await writer.request<{ outcome?: string }>({
          url: `${selfBase}/api/events`,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          data: envelope,
          validateStatus: () => true,
          timeout: 30_000,
        });
      } catch (error) {
        report.failed += 1;
        recordError(
          `${event}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        report.failed += 1;
        recordError(`${event}: HTTP ${response.status}`);
        continue;
      }

      switch (response.data?.outcome) {
        case "created":
          report.created += 1;
          break;
        case "merged":
          report.merged += 1;
          break;
        default:
          /*
            Overwhelmingly the normal outcome. A reconciliation replays rows
            that were already delivered, so a duplicate is the run confirming
            the two sides agree — not something gone wrong.
          */
          report.duplicates += 1;
      }
    }

    cursor = page.data.next_cursor ?? undefined;
    if (!cursor) break;
  }

  /*
    Two ways to stop before the queue ends: an explicit early stop (budget,
    failed page, bad body), or running out of the page ceiling with a cursor
    still in hand. Either way the report says so — a truncated run must never
    be readable as a clean one.
  */
  if (cursor || stoppedEarly) {
    report.nextCursor = cursor ?? null;
    report.truncated = true;
  }

  return report;
}
