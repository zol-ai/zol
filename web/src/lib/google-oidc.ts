import "server-only";

import { OAuth2Client } from "google-auth-library";

/**
 * Verifying a Google-signed OIDC ID token from another Google service.
 *
 * Used by the waitlist sweeper to establish that a request came from Cloud
 * Scheduler and not from whoever else found the URL. The endpoint is on a
 * public Cloud Run service, so this is the entire door.
 *
 * Four things have to hold, and all four matter:
 *
 *   1. The signature checks out against Google's published keys, and the
 *      issuer is Google. `verifyIdToken` does both.
 *   2. The `aud` claim equals our own URL. Without this, a token minted for
 *      any other Google service — by anyone, for anything — is replayable
 *      here. It is the difference between "Google signed this" and "this was
 *      meant for us".
 *   3. The email is one we expect. Google signs tokens for every service
 *      account on Earth; the signature says nothing about who is calling.
 *   4. `email_verified` is set, which for a service account it always is, and
 *      whose absence means the token is not the shape we think it is.
 */

export type TokenCheck =
  | { ok: true; email: string }
  | { ok: false; reason: string };

/** One client, reused: it caches Google's signing certificates. */
const oauth = new OAuth2Client();

/** The bearer token, or undefined. Case-insensitive scheme, per RFC 6750. */
export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

export async function verifyGoogleIdToken(
  token: string,
  audience: string,
  allowedEmails: readonly string[],
): Promise<TokenCheck> {
  /*
    An empty allowlist is a misconfiguration, and the safe reading of it is
    "nobody", not "everybody". Checked before the token is even parsed so a
    deploy that forgot the variable fails the same way every time.
  */
  if (allowedEmails.length === 0) {
    return { ok: false, reason: "no allowed callers configured" };
  }

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

  // Service account addresses are lowercase, but the allowlist is typed by a
  // person into an environment variable.
  const normalised = email.toLowerCase();
  if (!allowedEmails.some((allowed) => allowed.trim().toLowerCase() === normalised)) {
    return { ok: false, reason: `caller ${normalised} is not allowed` };
  }

  return { ok: true, email: normalised };
}
