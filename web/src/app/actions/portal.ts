"use server";

import { redirect } from "next/navigation";

import { query, tx } from "@/lib/db";
import { env } from "@/lib/env";
import {
  applyEstimateDecisions,
  decisionsFromForm,
  isEstimateExpired,
  type Decision,
} from "@/lib/estimates";
import { logRoEvent } from "@/lib/events";
import { invoiceBalanceCents } from "@/lib/invoices";
import { recordMessage } from "@/lib/messaging/provider";
import { notifyShop } from "@/lib/notifications";
import { recordPayment } from "@/lib/payments/provider";
import { createCheckoutSession } from "@/lib/payments/stripe";
import { portalPath, resolvePortalToken } from "@/lib/portal";
import { requestOrigin } from "@/lib/request-origin";
import type { FormState } from "./auth";

/**
 * What a customer can do from their repair page.
 *
 * No session, no account: the token in the URL is the whole credential, and
 * every action here starts by resolving it again. The token pins a shop, a
 * customer and one ticket, and nothing below touches a row that isn't inside
 * that triangle — an estimate id or invoice id from the form is only ever
 * used together with the token's repair order in the WHERE.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function back(token: string, params?: Record<string, string>): string {
  const search = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `${portalPath(token)}${search}`;
}

// -----------------------------------------------------------------------------
// Approve / decline
// -----------------------------------------------------------------------------

export async function respondToEstimate(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const token = text(form, "token");
  const estimateId = text(form, "estimate_id");
  const access = await resolvePortalToken(token);
  if (!access) return { error: "This link has expired. Call the shop for a new one." };

  const origin = await requestOrigin();

  const outcome = await tx(async (client) => {
    // The estimate has to be the token's ticket's, still open, and the newest
    // one — an older estimate left behind by a revision must not be answerable.
    const { rows } = await client.query<{
      id: string;
      status: string;
      expires_at: string | null;
      is_latest: boolean;
    }>(
      `SELECT e.id, e.status, e.expires_at::text,
              e.id = (SELECT id FROM estimates
                       WHERE repair_order_id = $2 ORDER BY created_at DESC LIMIT 1) AS is_latest
         FROM estimates e
        WHERE e.id = $1 AND e.repair_order_id = $2 AND e.shop_id = $3 AND e.customer_id = $4
        FOR UPDATE`,
      [estimateId, access.repairOrderId, access.shopId, access.customerId],
    );
    const estimate = rows[0];
    if (!estimate || !estimate.is_latest) return { error: "That estimate isn't open any more." };
    if (estimate.status === "draft") return { error: "That estimate hasn't been sent yet." };
    if (estimate.status !== "sent" && estimate.status !== "viewed") {
      return { error: "This estimate has already been answered. Call the shop if you'd like to change anything." };
    }
    if (isEstimateExpired(estimate)) {
      await client.query("UPDATE estimates SET status = 'expired' WHERE id = $1", [estimate.id]);
      return { error: "This estimate has expired. Call the shop and they'll send a fresh one." };
    }

    const { rows: lines } = await client.query<{ id: string }>(
      "SELECT id FROM estimate_lines WHERE estimate_id = $1",
      [estimate.id],
    );
    const lineIds = lines.map((line) => line.id);
    const decisions = decisionsFromForm(form, lineIds);

    // Every line needs an answer. The form defaults each one to approved, so
    // a missing value means the form was tampered with, not a customer who
    // forgot — refuse rather than guess.
    const complete: Record<string, Decision> = {};
    for (const id of lineIds) {
      const decision = decisions[id];
      if (!decision) return { error: "Please choose approve or decline for every line." };
      complete[id] = decision;
    }

    const result = await applyEstimateDecisions(client, {
      shopId: access.shopId,
      estimateId: estimate.id,
      decisions: complete,
      actor: "zol",
      origin,
    });
    return result ? { ok: true as const } : { error: "Something went wrong saving your answer." };
  });

  if ("error" in outcome) return { error: outcome.error };
  redirect(back(token, { answered: "1" }));
}

// -----------------------------------------------------------------------------
// Message the shop
// -----------------------------------------------------------------------------

const MESSAGE_MAX = 1000;

export async function sendPortalMessage(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const token = text(form, "token");
  const body = text(form, "body");
  const access = await resolvePortalToken(token);
  if (!access) return { error: "This link has expired. Call the shop instead." };

  if (body.length < 2) return { fields: { body: "Write a few words first." }, values: { body } };
  if (body.length > MESSAGE_MAX) {
    return { fields: { body: `Keep it under ${MESSAGE_MAX} characters.` }, values: { body } };
  }

  const rows = await query<{ number: number; full_name: string | null; vehicle: string | null }>(
    `SELECT ro.number, c.full_name,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle
       FROM repair_orders ro
       JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      WHERE ro.id = $1 AND ro.shop_id = $2 AND ro.customer_id = $3`,
    [access.repairOrderId, access.shopId, access.customerId],
  );
  const ro = rows[0];
  if (!ro) return { error: "This link has expired. Call the shop instead." };

  await tx(async (client) => {
    await recordMessage(client, {
      shopId: access.shopId,
      customerId: access.customerId,
      repairOrderId: access.repairOrderId,
      direction: "inbound",
      channel: "portal",
      body,
      status: "received",
      sentByAgent: false,
    });
    await logRoEvent(client, {
      shopId: access.shopId,
      repairOrderId: access.repairOrderId,
      kind: "message_received",
      detail: `Customer wrote from their repair page: “${body.length > 120 ? `${body.slice(0, 117)}…` : body}”`,
      actor: "zol",
    });
    await notifyShop(client, access.shopId, {
      kind: "message",
      title: `Message from ${ro.full_name ?? "a customer"} on #${ro.number}`,
      body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
      href: `/app/repair-orders/${access.repairOrderId}#conversation`,
    });
  });

  redirect(back(token, { sent: "1" }));
}

// -----------------------------------------------------------------------------
// Pay
// -----------------------------------------------------------------------------

async function openInvoiceFor(access: { shopId: string; customerId: string; repairOrderId: string }) {
  const rows = await query<{
    id: string;
    number: number;
    total_cents: number;
    paid_cents: number;
    status: string;
    email: string | null;
    shop_name: string;
  }>(
    `SELECT i.id, i.number, i.total_cents, i.paid_cents, i.status, c.email, s.name AS shop_name
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       JOIN shops s ON s.id = i.shop_id
      WHERE i.repair_order_id = $1 AND i.shop_id = $2 AND i.customer_id = $3`,
    [access.repairOrderId, access.shopId, access.customerId],
  );
  const invoice = rows[0];
  if (!invoice || invoice.status === "void" || invoice.status === "paid") return null;
  const balance = invoiceBalanceCents(invoice);
  return balance > 0 ? { ...invoice, balance } : null;
}

/**
 * The Pay button. With Stripe configured the customer is sent to Checkout
 * and the webhook records the result; without it, to a confirmation step
 * that says in plain words that no card will be charged. The two never mix:
 * a Stripe failure is an error message, not a quiet fall-through to demo.
 */
export async function startPayment(form: FormData): Promise<void> {
  const token = text(form, "token");
  const access = await resolvePortalToken(token);
  if (!access) redirect(portalPath(token));

  const invoice = await openInvoiceFor(access);
  if (!invoice) redirect(back(token));

  if (!env.stripe.configured) redirect(back(token, { pay: "confirm" }));

  const origin = await requestOrigin();
  let url: string;
  try {
    const session = await createCheckoutSession({
      secretKey: env.stripe.secretKey,
      amountCents: invoice.balance,
      description: `Invoice #${invoice.number} — ${invoice.shop_name}`,
      customerEmail: invoice.email,
      invoiceId: invoice.id,
      portalTokenId: access.tokenId,
      successUrl: `${origin}${back(token, { paid: "pending" })}`,
      cancelUrl: `${origin}${back(token, { cancelled: "1" })}`,
    });
    url = session.url;
  } catch (error) {
    console.error("[portal] stripe checkout failed", error);
    redirect(back(token, { pay: "failed" }));
  }
  redirect(url);
}

/**
 * The demo payment. Only reachable when no processor is configured, and the
 * row it writes says 'demo' on every screen that shows it.
 */
export async function payInvoiceDemo(form: FormData): Promise<void> {
  const token = text(form, "token");
  const access = await resolvePortalToken(token);
  if (!access) redirect(portalPath(token));
  if (env.stripe.configured) redirect(back(token));

  const invoice = await openInvoiceFor(access);
  if (!invoice) redirect(back(token));

  const origin = await requestOrigin();
  await tx((client) =>
    recordPayment(client, {
      invoiceId: invoice.id,
      shopId: access.shopId,
      amountCents: invoice.balance,
      method: "card",
      provider: "demo",
      // One demo payment per invoice: a double-tap collapses on the unique index.
      providerRef: `demo_${invoice.id}`,
      note: "Demo payment from the customer portal — no processor configured, no card charged.",
      origin,
    }),
  );

  redirect(back(token, { paid: "1" }));
}
