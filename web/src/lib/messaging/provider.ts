import "server-only";

import type { Queryable } from "@/lib/db";
import { env } from "@/lib/env";
import type { MessageChannel, MessageDirection } from "@/lib/statuses";

/**
 * The seam between "ZOL wants to tell the customer something" and how it
 * actually reaches them.
 *
 * Two providers today:
 *
 *   * **Twilio**, over its REST API with plain fetch — no SDK, the same
 *     choice `lib/twilio-signature.ts` made for the inbound side. Only chosen
 *     when ZOL_TELEPHONY_ENABLED is true and the account credentials plus a
 *     sending number are present. Carrier registration (A2P 10DLC) is what
 *     that flag waits on; an unregistered number that texts customers gets
 *     filtered and then blocked, with the damage landing on the shop.
 *
 *   * **Portal-only**, the default until then. Nothing leaves the building:
 *     the message is written to the customer's repair page, and the caller
 *     gets a truthful result saying so. The moment the flag flips, the same
 *     queued rows start going out as texts — no code upstream changes, which
 *     is the point of having this file.
 *
 * Email is not implemented (no sending domain yet — see lib/notify.ts); an
 * email channel degrades to portal-only the same way.
 */

export interface OutboundMessage {
  /** E.164. */
  to: string;
  body: string;
  channel: "sms" | "email" | "portal";
  /**
   * The shop's own line, when it has one. Falls back to the platform number.
   * A shop's customers should see the number they already know.
   */
  from?: string | null;
}

export type SendResult =
  | {
      delivered: true;
      /** Which door it went out of — `portal` means it did not leave. */
      via: "sms" | "portal";
      provider: "twilio" | "portal";
      providerId?: string;
    }
  | {
      delivered: false;
      provider: "twilio" | "portal";
      reason: string;
      /** True when retrying will never help — the number is invalid, or opted out. */
      permanent: boolean;
    };

export interface MessagingProvider {
  readonly name: "twilio" | "portal";
  send(message: OutboundMessage): Promise<SendResult>;
}

// -----------------------------------------------------------------------------
// Twilio
// -----------------------------------------------------------------------------

/**
 * Twilio error codes that mean "stop trying this number". Everything else is
 * treated as transient and left to the worker's next pass.
 * https://www.twilio.com/docs/api/errors
 */
const PERMANENT_TWILIO_ERRORS = new Set([
  21211, // invalid 'To'
  21214, // 'To' not a mobile
  21408, // permission to send to this region not enabled
  21610, // recipient has opted out (STOP)
  21614, // 'To' not a valid mobile number
  30006, // landline or unreachable carrier
]);

class TwilioProvider implements MessagingProvider {
  readonly name = "twilio" as const;

  async send(message: OutboundMessage): Promise<SendResult> {
    if (message.channel !== "sms") {
      return {
        delivered: false,
        provider: "twilio",
        reason: `${message.channel} is not a channel this provider sends on`,
        permanent: true,
      };
    }

    const from = message.from ?? env.twilio.phoneNumber;
    if (!from) {
      return {
        delivered: false,
        provider: "twilio",
        reason: "no sending number configured",
        permanent: false,
      };
    }

    const sid = env.twilio.accountSid;
    const body = new URLSearchParams({ To: message.to, From: from, Body: message.body });

    let response: Response;
    try {
      response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " + Buffer.from(`${sid}:${env.twilio.authToken}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (error) {
      return {
        delivered: false,
        provider: "twilio",
        reason: error instanceof Error ? error.message : "request failed",
        permanent: false,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      sid?: string;
      code?: number;
      message?: string;
    };

    if (!response.ok) {
      const code = typeof payload.code === "number" ? payload.code : undefined;
      return {
        delivered: false,
        provider: "twilio",
        reason: `HTTP ${response.status}${code ? ` / ${code}` : ""}: ${payload.message ?? "Twilio rejected the message"}`,
        permanent: code !== undefined && PERMANENT_TWILIO_ERRORS.has(code),
      };
    }

    return { delivered: true, via: "sms", provider: "twilio", providerId: payload.sid };
  }
}

// -----------------------------------------------------------------------------
// Portal-only
// -----------------------------------------------------------------------------

class PortalOnlyProvider implements MessagingProvider {
  readonly name = "portal" as const;

  async send(): Promise<SendResult> {
    // Nothing to do: the caller records the message against the customer and
    // it appears on their portal page. The result says exactly that.
    return { delivered: true, via: "portal", provider: "portal" };
  }
}

// -----------------------------------------------------------------------------
// Selection
// -----------------------------------------------------------------------------

export interface MessagingStatus {
  mode: "twilio" | "portal-only";
  /** Why it isn't Twilio, when it isn't. Safe to show an owner in settings. */
  reason?: string;
}

/** What settings and the health probe report. Never throws. */
export function messagingStatus(): MessagingStatus {
  if (!env.telephonyEnabled) {
    return {
      mode: "portal-only",
      reason: "Texting is switched off until carrier registration clears.",
    };
  }
  if (!env.twilio.configured) {
    return { mode: "portal-only", reason: "Twilio credentials are not configured." };
  }
  if (!env.twilio.phoneNumber) {
    return { mode: "portal-only", reason: "No Twilio sending number is configured." };
  }
  return { mode: "twilio" };
}

let provider: MessagingProvider | undefined;

export function getMessagingProvider(): MessagingProvider {
  provider ??= messagingStatus().mode === "twilio" ? new TwilioProvider() : new PortalOnlyProvider();
  return provider;
}

// -----------------------------------------------------------------------------
// The record of what was said
// -----------------------------------------------------------------------------

export interface MessageRecord {
  shopId: string;
  customerId: string;
  repairOrderId?: string | null;
  direction: MessageDirection;
  channel: MessageChannel;
  body: string;
  /** Who wrote it, when a person did. */
  staffId?: string | null;
  followUpId?: string | null;
  twilioSid?: string | null;
  status?: "queued" | "sent" | "delivered" | "failed" | "received";
  errorCode?: string | null;
  sentByAgent?: boolean;
}

/** Append to the conversation history. Never updates; the history is what happened. */
export async function recordMessage(
  client: Queryable,
  message: MessageRecord,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO messages
       (shop_id, customer_id, repair_order_id, direction, channel, body,
        staff_id, follow_up_id, twilio_sid, status, error_code, sent_by_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      message.shopId,
      message.customerId,
      message.repairOrderId ?? null,
      message.direction,
      message.channel,
      message.body,
      message.staffId ?? null,
      message.followUpId ?? null,
      message.twilioSid ?? null,
      message.status ?? (message.direction === "inbound" ? "received" : "sent"),
      message.errorCode ?? null,
      message.sentByAgent ?? !message.staffId,
    ],
  );
  return rows[0].id;
}
