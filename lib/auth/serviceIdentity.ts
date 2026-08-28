import "server-only";

import { OAuth2Client } from "google-auth-library";

/**
 * Machine callers.
 *
 * Every other route in this application authenticates a person: a Firebase
 * session cookie, minted from an interactive Google Sign-In and checked
 * against ALLOWED_EMAILS. `/api/events` authenticates a *service* — a Google
 * signed OIDC ID token from another Cloud Run deployment — and that is a
 * different door with a different key.
 *
 * The two allowlists are kept separate on purpose. Merging them would mean a
 * human session could reach the ingest route, or a service account could reach
 * the workspace; neither is something anybody would ask for, and both are what
 * a single shared list eventually produces.
 *
 * Four checks, and dropping any one of them opens the door:
 *
 *   1. Google's signature, and Google as the issuer. `verifyIdToken` does both.
 *   2. `aud` equals this service's own URL. Without it, a token minted for any
 *      other Google service is replayable here — the signature proves Google
 *      signed it, not that it was meant for us.
 *   3. The caller's email is one we expect. Google signs tokens for every
 *      service account in existence.
 *   4. `email_verified`, which a service account token always carries, and
 *      whose absence means this is not the kind of token we think it is.
 */

export type ServiceCallerCheck =
  | { ok: true; email: string }
  | { ok: false; reason: string };

/** Reused across requests: it caches Google's signing certificates. */
const oauth = new OAuth2Client();

/** Service accounts permitted to POST events. Distinct from ALLOWED_EMAILS. */
export function allowedServiceAccounts() {
  return (process.env.EVENTS_ALLOWED_SERVICE_ACCOUNTS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The audience the caller must have minted its token for: this service's own
 * public URL, compared exactly rather than parsed.
 */
export function expectedAudience() {
  return process.env.EVENTS_AUDIENCE?.trim() || undefined;
}

/** The bearer token, or undefined. Case-insensitive scheme, per RFC 6750. */
export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

export async function verifyServiceCaller(
  request: Request,
): Promise<ServiceCallerCheck> {
  const audience = expectedAudience();
  const allowed = allowedServiceAccounts();

  /*
    Missing configuration fails closed, and is checked before the token is even
    parsed so a deploy that forgot a variable fails the same way every time.
    An empty allowlist reads as "nobody", never "everybody" — the safe reading
    of an unset value is the one where a misconfigured deploy ingests nothing
    rather than accepting anything.
  */
  if (!audience) return { ok: false, reason: "EVENTS_AUDIENCE is not set" };
  if (allowed.length === 0) {
    return { ok: false, reason: "EVENTS_ALLOWED_SERVICE_ACCOUNTS is not set" };
  }

  const token = bearerToken(request);
  if (!token) return { ok: false, reason: "no bearer token" };

  let email: string | undefined;
  let verified: boolean | undefined;

  try {
    const ticket = await oauth.verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    email = payload?.email;
    verified = payload?.email_verified;
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "token did not verify",
    };
  }

  if (!email || verified !== true) {
    return { ok: false, reason: "token carries no verified email" };
  }

  const normalised = email.toLowerCase();
  if (!allowed.includes(normalised)) {
    return { ok: false, reason: `caller ${normalised} is not allowed` };
  }

  return { ok: true, email: normalised };
}
