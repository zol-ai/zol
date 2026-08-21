import { env } from "@/lib/env";
import {
  isValidTwilioSignature,
  readWebhookParams,
  signedUrlFor,
} from "@/lib/twilio-signature";
import { twimlResponse, xml } from "@/lib/twiml";

export const dynamic = "force-dynamic";

/**
 * Inbound SMS webhook — customer replies to follow-ups land here.
 *
 * STOP/HELP handling is not optional decoration: carriers require it, and
 * getting it wrong is what gets a shop's number blocked. Twilio's Advanced
 * Opt-Out handles the keywords at the carrier level once the campaign is
 * registered; this handler still honours them so behaviour is identical in
 * local development and during the pre-registration period.
 */
const STOP_WORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
]);
const HELP_WORDS = new Set(["help", "info"]);

export async function POST(request: Request) {
  const params = await readWebhookParams(request);

  const valid = isValidTwilioSignature({
    authToken: env.twilio.authToken,
    signature: request.headers.get("x-twilio-signature"),
    url: signedUrlFor(request, env.publicUrl),
    params,
  });

  if (!valid) {
    return new Response("Invalid signature", { status: 403 });
  }

  const body = (params.Body ?? "").trim().toLowerCase();

  if (STOP_WORDS.has(body)) {
    // TODO(persistence): flag the customer as opted out before replying, so a
    // queued follow-up can't go out after they asked us to stop.
    return twimlResponse(
      `<Message>${xml(
        "You're unsubscribed and won't get any more texts from this shop. Reply START to turn them back on.",
      )}</Message>`,
    );
  }

  if (HELP_WORDS.has(body)) {
    return twimlResponse(
      `<Message>${xml(
        "This is the service line for your repair shop. Reply STOP to unsubscribe. Message and data rates may apply.",
      )}</Message>`,
    );
  }

  if (!env.telephonyEnabled) {
    return twimlResponse("", 503);
  }

  // TODO(phase 2): thread the message onto the customer's conversation, run it
  // through the agent, and reply with the answer. Silence for now beats an
  // automated reply we can't stand behind.
  return twimlResponse("");
}
