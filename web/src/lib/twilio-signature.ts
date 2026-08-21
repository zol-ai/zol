import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies the `X-Twilio-Signature` header on an inbound webhook.
 *
 * Twilio signs a string built by taking the full request URL and appending, in
 * alphabetical order by key, every POST parameter as key immediately followed
 * by value. That string is HMAC-SHA1'd with the account auth token and base64
 * encoded. Implemented directly against node:crypto so we don't pull in the
 * Twilio SDK just to check one header.
 *
 * Reference: https://www.twilio.com/docs/usage/security#validating-requests
 *
 * Anyone can POST to a public webhook URL. Without this check a stranger could
 * make ZOL text your customers, so treat a failure as hostile, not as a bug.
 */
export function isValidTwilioSignature({
  authToken,
  signature,
  url,
  params,
}: {
  authToken: string;
  signature: string | null;
  /** The exact public URL Twilio was configured to call, including query. */
  url: string;
  /** Form-encoded body parameters from the webhook. */
  params: Record<string, string>;
}): boolean {
  if (!signature) return false;

  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = createHmac("sha1", authToken).update(payload, "utf8").digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64");
  } catch {
    return false;
  }

  // timingSafeEqual throws on length mismatch, so guard before comparing.
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

/**
 * Rebuilds the URL Twilio actually signed. Behind Vercel and Cloud Run the
 * inbound `Host` header is a proxy host and the protocol is terminated
 * upstream, so a signature check against `request.url` fails for reasons that
 * look nothing like the real cause. Pin the origin with ZOL_PUBLIC_URL.
 */
export function signedUrlFor(request: Request, publicUrl?: string): string {
  const incoming = new URL(request.url);
  if (!publicUrl) return incoming.toString();

  const base = new URL(publicUrl);
  incoming.protocol = base.protocol;
  incoming.host = base.host;
  incoming.port = base.port;
  return incoming.toString();
}

/** Reads a Twilio form-encoded webhook body into a plain object. */
export async function readWebhookParams(
  request: Request,
): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}
