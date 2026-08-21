import { env } from "@/lib/env";
import {
  isValidTwilioSignature,
  readWebhookParams,
  signedUrlFor,
} from "@/lib/twilio-signature";
import { twimlResponse, xml } from "@/lib/twiml";

export const dynamic = "force-dynamic";

/**
 * Inbound call webhook.
 *
 * Phase 1 (now): parked. Carrier registration hasn't cleared, so this refuses
 * to answer rather than transacting on an unregistered number.
 *
 * Phase 2: hand the audio to the realtime model over a media stream and let it
 * run the conversation — see docs/ARCHITECTURE.md. The stream terminates on
 * the Cloud Run service, not here, because Vercel's serverless runtime won't
 * hold a WebSocket open for the length of a call.
 */
export async function POST(request: Request) {
  const params = await readWebhookParams(request);

  // Verify before doing anything else. An unverified POST is a stranger.
  const valid = isValidTwilioSignature({
    authToken: env.twilio.authToken,
    signature: request.headers.get("x-twilio-signature"),
    url: signedUrlFor(request, env.publicUrl),
    params,
  });

  if (!valid) {
    return new Response("Invalid signature", { status: 403 });
  }

  if (!env.telephonyEnabled) {
    // Fail closed, and say something a caller can act on rather than dead air.
    return twimlResponse(
      `<Say voice="Polly.Joanna">${xml(
        "Thanks for calling. Our automated line isn't taking calls yet. Please leave a message after the tone and the shop will get back to you.",
      )}</Say><Record maxLength="120" playBeep="true" transcribe="false"/><Hangup/>`,
      503,
    );
  }

  const streamUrl = process.env.ZOL_MEDIA_STREAM_URL;

  if (!streamUrl) {
    return twimlResponse(
      `<Say voice="Polly.Joanna">${xml(
        "One moment while I connect you to the shop.",
      )}</Say><Hangup/>`,
    );
  }

  // Bidirectional audio to the realtime agent running on Cloud Run.
  return twimlResponse(
    `<Connect><Stream url="${xml(streamUrl)}">` +
      `<Parameter name="callSid" value="${xml(params.CallSid ?? "")}"/>` +
      `<Parameter name="from" value="${xml(params.From ?? "")}"/>` +
      `<Parameter name="to" value="${xml(params.To ?? "")}"/>` +
      `</Stream></Connect>`,
  );
}
