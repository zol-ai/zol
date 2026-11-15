import twilio from "twilio";
import { env } from "../env";

/**
 * Verify a Twilio webhook. Twilio signs the exact public URL it was told to
 * call plus the form body, so we rebuild the URL from PUBLIC_BASE_URL rather
 * than trusting the Host header behind the Cloud Run proxy.
 */
export async function readVerifiedTwilioForm(
  request: Request,
): Promise<Record<string, string> | null> {
  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  if (env.skipTwilioSignature()) return params;

  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return null;

  const incoming = new URL(request.url);
  const url = `${env.publicBaseUrl()}${incoming.pathname}${incoming.search}`;
  const ok = twilio.validateRequest(env.twilioAuthToken(), signature, url, params);
  return ok ? params : null;
}

export function twimlResponse(xml: string): Response {
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
