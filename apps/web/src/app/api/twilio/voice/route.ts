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
 * Today: parked. Carrier registration hasn't cleared, so this refuses to
 * answer rather than transacting on an unregistered number. A caller hears a
 * short message and can leave one; nothing is transcribed and nothing is
 * booked.
 *
 * When ZOL_TELEPHONY_ENABLED flips: the audio is handed to the realtime media
 * service over a bidirectional <Stream>. That service runs the conversation
 * against the model and, when the call ends, calls
 * `finalizeVoiceCall` (lib/receptionist/engine.ts) with the transcript — the
 * same function the "Run a test call" button exercises today. The stream
 * terminates on Cloud Run, not here, because a serverless function won't
 * hold a WebSocket open for the length of a call. Contract and payload:
 * docs/TELEPHONY.md.
 */
export async function POST(request: Request) {
  // Without the auth token there is no way to tell Twilio from a stranger.
  if (!env.twilio.configured) {
    return new Response("Telephony is not configured", { status: 503 });
  }

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

  const streamUrl = env.twilio.mediaStreamUrl;

  if (!streamUrl) {
    // The flag is on but no media service is deployed to take the audio.
    // Same voicemail as above: better a message than a promise nobody keeps.
    return twimlResponse(
      `<Say voice="Polly.Joanna">${xml(
        "Thanks for calling. Our automated line is being set up. Please leave a message after the tone and the shop will get back to you.",
      )}</Say><Record maxLength="120" playBeep="true" transcribe="false"/><Hangup/>`,
    );
  }

  // Bidirectional audio to the realtime receptionist on Cloud Run. The
  // parameters ride along so the service can call finalizeVoiceCall with the
  // call's identity when it ends.
  return twimlResponse(
    `<Connect><Stream url="${xml(streamUrl)}">` +
      `<Parameter name="callSid" value="${xml(params.CallSid ?? "")}"/>` +
      `<Parameter name="from" value="${xml(params.From ?? "")}"/>` +
      `<Parameter name="to" value="${xml(params.To ?? "")}"/>` +
      `</Stream></Connect>`,
  );
}
