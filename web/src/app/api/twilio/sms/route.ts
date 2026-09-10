import { db, query, tx } from "@/lib/db";
import { env } from "@/lib/env";
import { recordMessage } from "@/lib/messaging/provider";
import { notifyShop } from "@/lib/notifications";
import { formatPhone, toE164 } from "@/lib/phone";
import { handleTurn, startConversation } from "@/lib/receptionist/engine";
import {
  isValidTwilioSignature,
  readWebhookParams,
  signedUrlFor,
} from "@/lib/twilio-signature";
import { twimlResponse, xml } from "@/lib/twiml";

export const dynamic = "force-dynamic";

/**
 * Inbound SMS webhook — customer replies to follow-ups, and the receptionist
 * by text.
 *
 * STOP/HELP handling is not optional decoration: carriers require it, and
 * getting it wrong is what gets a shop's number blocked. Twilio's Advanced
 * Opt-Out handles the keywords at the carrier level once the campaign is
 * registered; this handler still honours them so behaviour is identical in
 * local development and during the pre-registration period — and because the
 * opt-out has to land in *our* table, where the follow-up worker checks it
 * before every send.
 *
 * Which table row depends on the line that was texted. A shop with its own
 * `twilio_number` is found by `To`. A shop without one texts from the
 * platform number (lib/messaging/provider.ts), and a STOP that comes back on
 * it names no shop — so it is applied at every shop that has no line and has
 * this person on file. The customer opted out of the number; that is who
 * texts from it.
 *
 * With ZOL_TELEPHONY_ENABLED off, everything that isn't STOP/HELP fails
 * closed (503). With it on, the text is threaded onto the customer's open SMS
 * conversation and answered by the same engine that runs the web chat.
 * See docs/TELEPHONY.md.
 */
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "unstop", "yes"]);
const HELP_WORDS = new Set(["help", "info"]);

const STOP_REPLY =
  "You're unsubscribed and won't get any more texts from this shop. Reply START to turn them back on.";
const START_REPLY =
  "You're opted back in to texts from this shop. Reply STOP at any time to stop them.";
const HELP_REPLY =
  "This is the service line for your repair shop. Reply STOP to unsubscribe. Message and data rates may apply.";

/** The shop whose line was texted. `To` is the number ZOL answers on. */
async function shopForLine(to: string | null): Promise<{ id: string } | null> {
  if (!to) return null;
  const rows = await query<{ id: string }>("SELECT id FROM shops WHERE twilio_number = $1", [to]);
  return rows[0] ?? null;
}

/** Whether `To` is the platform number — the line shops without one text from. */
function isPlatformLine(to: string | null): boolean {
  if (!to || !env.twilio.phoneNumber) return false;
  return to === toE164(env.twilio.phoneNumber);
}

interface CustomerRow {
  id: string;
  sms_opted_out: boolean;
}

async function customerFor(shopId: string, phone: string): Promise<CustomerRow | null> {
  const rows = await query<CustomerRow>(
    "SELECT id, sms_opted_out FROM customers WHERE shop_id = $1 AND phone = $2",
    [shopId, phone],
  );
  return rows[0] ?? null;
}

/**
 * STOP: the flag the worker reads, the timestamp for the audit, every queued
 * message for that person cancelled, and any open text thread with the
 * receptionist closed — they asked us to stop talking.
 */
async function optOut(shopId: string, phone: string): Promise<void> {
  await tx(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE customers
          SET sms_opted_out = true, sms_opted_out_at = coalesce(sms_opted_out_at, now())
        WHERE shop_id = $1 AND phone = $2
        RETURNING id`,
      [shopId, phone],
    );
    const customer = rows[0];
    if (customer) {
      await client.query(
        "UPDATE follow_ups SET status = 'cancelled' WHERE customer_id = $1 AND status = 'pending'",
        [customer.id],
      );
    }
    await client.query(
      `UPDATE conversations SET status = 'abandoned'
        WHERE shop_id = $1 AND phone = $2 AND channel = 'sms' AND status IN ('open', 'escalated')`,
      [shopId, phone],
    );
  });
}

/**
 * The same STOP, arriving on the platform number: no `To` names a shop, so
 * it lands at every shop that texts from that number — the ones with no
 * line of their own — where this phone is a customer.
 */
async function optOutOnPlatformLine(phone: string): Promise<void> {
  await tx(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE customers c
          SET sms_opted_out = true, sms_opted_out_at = coalesce(c.sms_opted_out_at, now())
         FROM shops s
        WHERE s.id = c.shop_id AND s.twilio_number IS NULL AND c.phone = $1
        RETURNING c.id`,
      [phone],
    );
    if (rows.length > 0) {
      await client.query(
        "UPDATE follow_ups SET status = 'cancelled' WHERE status = 'pending' AND customer_id = ANY($1::uuid[])",
        [rows.map((row) => row.id)],
      );
    }
    await client.query(
      `UPDATE conversations SET status = 'abandoned'
        WHERE phone = $1 AND channel = 'sms' AND status IN ('open', 'escalated')
          AND shop_id IN (SELECT id FROM shops WHERE twilio_number IS NULL)`,
      [phone],
    );
  });
}

async function optIn(shopId: string, phone: string): Promise<void> {
  await query(
    `UPDATE customers SET sms_opted_out = false, sms_opted_out_at = NULL
      WHERE shop_id = $1 AND phone = $2`,
    [shopId, phone],
  );
}

async function optInOnPlatformLine(phone: string): Promise<void> {
  await query(
    `UPDATE customers c
        SET sms_opted_out = false, sms_opted_out_at = NULL
       FROM shops s
      WHERE s.id = c.shop_id AND s.twilio_number IS NULL AND c.phone = $1`,
    [phone],
  );
}

/**
 * The inbound line, into the customer's message history. False when Twilio
 * re-delivered a webhook this route has already recorded — messages.twilio_sid
 * is unique, and 23505 is how Postgres says so.
 */
async function recordInbound(
  shopId: string,
  customerId: string,
  text: string,
  sid: string | null,
): Promise<boolean> {
  try {
    await recordMessage(await db(), {
      shopId,
      customerId,
      direction: "inbound",
      channel: "sms",
      body: text,
      twilioSid: sid,
      status: "received",
      sentByAgent: false,
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return false;
    throw error;
  }
}

/** Whether the earlier delivery of this webhook got as far as a reply. */
async function answered(shopId: string, customerId: string, sid: string): Promise<boolean> {
  const rows = await query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM messages o
        WHERE o.shop_id = $1 AND o.customer_id = $2
          AND o.direction = 'outbound' AND o.channel = 'sms'
          AND o.created_at >= (SELECT i.created_at FROM messages i WHERE i.twilio_sid = $3)
     ) AS ok`,
    [shopId, customerId, sid],
  );
  return rows[0]?.ok ?? false;
}

export async function POST(request: Request) {
  // Without the auth token there is no way to tell Twilio from a stranger,
  // so there is nothing this route can safely do.
  if (!env.twilio.configured) {
    return new Response("Telephony is not configured", { status: 503 });
  }

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

  const text = (params.Body ?? "").trim();
  const keyword = text.toLowerCase();
  const from = toE164(params.From ?? "") ?? null;
  const to = toE164(params.To ?? "") ?? null;
  const shop = await shopForLine(to);
  const platformLine = !shop && isPlatformLine(to);

  if (STOP_WORDS.has(keyword)) {
    // Flag first, reply second: a queued follow-up must not slip out between
    // the two. An unknown number still gets the carrier-required reply.
    if (from) {
      if (shop) await optOut(shop.id, from);
      else if (platformLine) await optOutOnPlatformLine(from);
    }
    return twimlResponse(`<Message>${xml(STOP_REPLY)}</Message>`);
  }

  if (START_WORDS.has(keyword)) {
    if (from) {
      if (shop) await optIn(shop.id, from);
      else if (platformLine) await optInOnPlatformLine(from);
    }
    return twimlResponse(`<Message>${xml(START_REPLY)}</Message>`);
  }

  if (HELP_WORDS.has(keyword)) {
    return twimlResponse(`<Message>${xml(HELP_REPLY)}</Message>`);
  }

  if (!env.telephonyEnabled) {
    return twimlResponse("", 503);
  }

  // No tenant owns this line, or the sender isn't a phone number: nothing to
  // thread onto. An empty <Response> is Twilio for "no reply".
  if (!shop || !from || !text) {
    return twimlResponse("");
  }

  /*
    The message history (`messages`) is per customer, and a first-time texter
    has no customer row until the receptionist has their details. The
    conversation transcript keeps every word regardless; the customer-facing
    history picks up from the first message after they're on file.
  */
  const customerBefore = await customerFor(shop.id, from);
  const sid = params.MessageSid ?? null;

  if (customerBefore?.sms_opted_out) {
    /*
      Carrier rule, the same one the composer and the follow-up worker apply:
      once they've said STOP, nothing goes out until they say START — not
      even a reply to something they sent. Their text is still kept, and a
      person is told, because "is my car ready" deserves an answer; it has to
      be a call.
    */
    const fresh = await recordInbound(shop.id, customerBefore.id, text, sid);
    if (fresh) {
      await notifyShop(await db(), shop.id, {
        kind: "message",
        title: "Text from a customer who has opted out",
        body: `${formatPhone(from)}: "${text.slice(0, 160)}" — texts are stopped, so this needs a call.`,
        href: `/app/customers/${customerBefore.id}`,
      });
    }
    return twimlResponse("");
  }

  // The customer's open thread with the receptionist, or a new one.
  const open = await query<{ id: string }>(
    `SELECT id FROM conversations
      WHERE shop_id = $1 AND phone = $2 AND channel = 'sms' AND status IN ('open', 'escalated')
      ORDER BY created_at DESC LIMIT 1`,
    [shop.id, from],
  );
  const conversationId =
    open[0]?.id ?? (await startConversation({ shopId: shop.id, channel: "sms", phone: from })).conversationId;

  if (customerBefore) {
    const fresh = await recordInbound(shop.id, customerBefore.id, text, sid);
    /*
      A re-delivered webhook. Twilio retries when the earlier attempt didn't
      answer — and it may not have: the inbound row commits before the turn
      runs, so a turn that died in the database leaves the row behind with no
      reply. Stay silent only when a reply actually went out; otherwise the
      customer is still waiting, and this attempt answers them.
    */
    if (!fresh && sid && (await answered(shop.id, customerBefore.id, sid))) {
      return twimlResponse("");
    }
  }

  const outcome = await handleTurn({ conversationId, text });

  const customerAfter = customerBefore?.id ?? (await customerFor(shop.id, from))?.id ?? null;
  if (customerAfter) {
    await recordMessage(await db(), {
      shopId: shop.id,
      customerId: customerAfter,
      direction: "outbound",
      channel: "sms",
      body: outcome.reply,
      status: "sent",
      sentByAgent: true,
    });
  }

  return twimlResponse(`<Message>${xml(outcome.reply)}</Message>`);
}
