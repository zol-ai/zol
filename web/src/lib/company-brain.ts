import "server-only";

import { GoogleAuth } from "google-auth-library";

import { env } from "@/lib/env";
import { waitlistEvent, type WaitlistEntry } from "@/lib/waitlist";

/**
 * Delivery of one waitlist entry to Company OS.
 *
 * Called by the sweeper (`/api/waitlist/sweep`), never by the submission path.
 * That distinction is the whole design: this function is allowed to fail,
 * because a failure leaves `delivered_at` null and the next sweep tries again.
 * It used to be called inline from the Server Action wrapped in a `.catch()`,
 * where a failure meant the lead was simply gone.
 *
 * Authentication is a Google-signed OIDC ID token minted from the Cloud Run
 * metadata server, with `audience` set to Company OS's own URL. It is the only
 * credential path here — no Workload Identity Federation, no Vercel branch.
 * `lib/db.ts` does have a federated path for reaching Cloud SQL from Vercel,
 * but that is the database and is unrelated; the sweeper runs on Cloud Run and
 * nowhere else, and off Cloud Run this fails loudly rather than degrading into
 * an unauthenticated POST.
 */

/**
 * `delivered` is the only outcome that stamps the row.
 *
 * `rejected` is separated from `failed` on purpose. A 4xx that isn't 401/429
 * is the receiver saying this payload is wrong — a malformed phone number, a
 * field it does not accept — and retrying it every five minutes until the
 * seven-day window closes just prints the same error 2,000 times. It stays
 * undelivered either way; the distinction is what the log says, and whether
 * the sweeper bothers with the rest of the batch.
 */
export type DeliveryResult =
  | { status: "delivered" }
  | { status: "rejected"; code: number; detail: string }
  | { status: "failed"; detail: string };

/**
 * Memoised across invocations on a warm instance.
 *
 * `getIdTokenClient` does a metadata-server round trip to work out the service
 * account's identity; the client it returns caches the token itself and
 * refreshes it before expiry. Building a new one per row would mean a fetch
 * per lead for no benefit.
 */
let client: Promise<Awaited<ReturnType<GoogleAuth["getIdTokenClient"]>>> | undefined;

function idTokenClient(audience: string) {
  client ??= new GoogleAuth().getIdTokenClient(audience).catch((error: unknown) => {
    // Don't cache a failed handshake — a transient metadata-server blip would
    // otherwise poison every delivery until the instance recycled.
    client = undefined;
    throw error;
  });
  return client;
}

export async function pushWaitlistEntryToCompanyBrain(
  entry: WaitlistEntry,
): Promise<DeliveryResult> {
  const base = env.companyOs.url.replace(/\/+$/, "");

  /*
    Built by the shared builder, not here. `GET /api/waitlist/entries` returns
    the output of the same function, so the reconciliation path and this one
    cannot drift into sending two different envelopes for the same row.
  */
  const envelope = waitlistEvent(entry);

  let response: { status: number; body: string };

  try {
    const auth = await idTokenClient(base);
    const result = await auth.request<unknown>({
      url: `${base}/api/events`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: envelope,
      // We interpret every status ourselves; the library throwing on 4xx would
      // collapse "your payload is wrong" and "the network broke" into one
      // catch block that can only guess which happened.
      validateStatus: () => true,
      timeout: 10_000,
      responseType: "text",
    });
    response = {
      status: result.status,
      body: typeof result.data === "string" ? result.data : JSON.stringify(result.data),
    };
  } catch (error) {
    // No response at all: DNS, TLS, timeout, or no metadata server to mint a
    // token from. Always worth retrying.
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  /*
    A duplicate is a success. The receiver answers 200 to an event it has
    already applied — that is what makes a sweeper safe to run every five
    minutes — so there is nothing here to distinguish and nothing to do.
  */
  if (response.status >= 200 && response.status < 300) {
    return { status: "delivered" };
  }

  const detail = response.body.slice(0, 500);

  /*
    401 is us, not the payload: a clock skew, a rotated service account, an
    audience that stopped matching after a redeploy. Retrying is right, because
    the fix happens on our side and the row should go the moment it lands.

    429 is a request to come back later, which is what the next sweep is.
  */
  if (response.status === 401 || response.status === 429 || response.status >= 500) {
    return { status: "failed", detail: `HTTP ${response.status}: ${detail}` };
  }

  return { status: "rejected", code: response.status, detail };
}
