"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { logRoEvent } from "@/lib/events";
import { getMessagingProvider, recordMessage } from "@/lib/messaging/provider";

/**
 * A person at the shop writing to a customer, or to the rest of the shop.
 *
 * This is the one place in the product that calls the messaging provider
 * directly instead of queueing a follow-up. The rule elsewhere ("pages and
 * actions never call a provider") exists because ZOL's journey messages are
 * fired by status changes nobody is watching, and a queue is what makes them
 * survive a redeploy and respect an opt-out at send time. A person pressing
 * Send is different: they are watching, they expect it to go *now*, and if
 * it fails they want to know now — not find a 'failed' row in the CRM
 * tomorrow. So it goes out synchronously and the result, good or bad, is
 * written into the thread where they can see it.
 *
 * Internal notes never leave the building; they are the same table with
 * channel 'note' so the thread reads in order.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const BODY_MAX = 1000;

/** Only ever a path inside the app — a return address from a form is not to be trusted further than that. */
function safeReturn(candidate: string, fallback: string): string {
  return candidate.startsWith("/app/") && !candidate.startsWith("//") ? candidate : fallback;
}

export async function sendCustomerMessage(form: FormData): Promise<void> {
  const user = await requireUser();
  const customerId = text(form, "customer_id");
  const repairOrderId = text(form, "repair_order_id") || null;
  const channel = text(form, "channel");
  const body = text(form, "body").slice(0, BODY_MAX);
  const returnTo = safeReturn(text(form, "return_to"), `/app/messages?customer=${customerId}`);

  if (!body || (channel !== "text" && channel !== "note")) redirect(returnTo);

  // The customer must be this shop's, and the ticket — if given — must be
  // theirs. Both ids arrive from a form and prove nothing on their own.
  const rows = await query<{
    phone: string;
    sms_opted_out: boolean;
    full_name: string | null;
    twilio_number: string | null;
    ro_ok: boolean;
  }>(
    `SELECT c.phone, c.sms_opted_out, c.full_name, s.twilio_number,
            ($3::uuid IS NULL OR EXISTS (
               SELECT 1 FROM repair_orders ro
                WHERE ro.id = $3 AND ro.customer_id = c.id AND ro.shop_id = $2)) AS ro_ok
       FROM customers c
       JOIN shops s ON s.id = c.shop_id
      WHERE c.id = $1 AND c.shop_id = $2`,
    [customerId, user.shopId, repairOrderId],
  );
  const customer = rows[0];
  if (!customer || !customer.ro_ok) redirect("/app/messages");

  if (channel === "note") {
    await tx(async (client) => {
      await recordMessage(client, {
        shopId: user.shopId,
        customerId,
        repairOrderId,
        direction: "internal",
        channel: "note",
        body,
        staffId: user.staffId,
        status: "sent",
        sentByAgent: false,
      });
      if (repairOrderId) {
        await logRoEvent(client, {
          shopId: user.shopId,
          repairOrderId,
          kind: "note",
          detail: body.length > 140 ? `${body.slice(0, 137)}…` : body,
          actor: "person",
          staffId: user.staffId,
        });
      }
    });
  } else {
    // The composer already hides the text option for an opted-out customer
    // and says why; this is the backstop for a stale page. Carrier rule:
    // once they've said STOP, nothing goes out until they say START.
    if (customer.sms_opted_out) redirect(returnTo);

    const result = await getMessagingProvider().send({
      to: customer.phone,
      body,
      channel: "sms",
      from: customer.twilio_number,
    });

    await tx(async (client) => {
      await recordMessage(client, {
        shopId: user.shopId,
        customerId,
        repairOrderId,
        direction: "outbound",
        // 'portal' when telephony is off: the message is on their repair page
        // and the thread says so, rather than pretending a text went out.
        channel: result.delivered ? result.via : "sms",
        body,
        staffId: user.staffId,
        twilioSid: result.delivered ? (result.providerId ?? null) : null,
        status: result.delivered ? "sent" : "failed",
        errorCode: result.delivered ? null : result.reason.slice(0, 200),
        sentByAgent: false,
      });
      if (repairOrderId) {
        await logRoEvent(client, {
          shopId: user.shopId,
          repairOrderId,
          kind: "message_sent",
          detail: result.delivered
            ? `${user.fullName} messaged the customer${result.via === "portal" ? " (on their repair page)" : ""}.`
            : `Message to the customer failed: ${result.reason}`,
          actor: "person",
          staffId: user.staffId,
        });
      }
    });
  }

  if (repairOrderId) revalidatePath(`/app/repair-orders/${repairOrderId}`);
  revalidatePath("/app/messages");
  redirect(returnTo);
}
