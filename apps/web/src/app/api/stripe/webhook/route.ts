import { query, tx } from "@/lib/db";
import { env } from "@/lib/env";
import { recordPayment } from "@/lib/payments/provider";
import { readCompletedCheckout, verifyStripeSignature } from "@/lib/payments/stripe";
import { requestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

/**
 * Stripe telling us a Checkout Session was paid.
 *
 * The body is read as raw text because the signature covers the bytes Stripe
 * sent, not a re-serialisation of them. Without a webhook secret the route
 * refuses everything: an unsigned "it was paid" from anyone on the internet
 * would close tickets and text receipts, so failing closed is the only
 * sensible default.
 *
 * Stripe retries until it sees a 2xx, and may deliver twice. The payment
 * row is unique on the provider reference, so the second delivery is
 * recognised as a duplicate and answered 200 without writing anything.
 */
export async function POST(request: Request) {
  const secret = env.stripe.webhookSecret;
  if (!secret) {
    return new Response("Stripe webhooks are not configured", { status: 503 });
  }

  const payload = await request.text();
  const valid = verifyStripeSignature({
    payload,
    header: request.headers.get("stripe-signature"),
    secret,
  });
  if (!valid) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Malformed body", { status: 400 });
  }

  const checkout = readCompletedCheckout(event);
  // Anything that isn't a completed checkout is acknowledged and ignored —
  // Stripe would otherwise keep retrying an event we never subscribed to.
  if (!checkout) return Response.json({ received: true, handled: false });
  if (checkout.paymentStatus !== "paid") return Response.json({ received: true, handled: false });
  if (!checkout.invoiceId) {
    console.warn("[stripe] checkout.session.completed without invoice_id metadata", checkout.sessionId);
    return Response.json({ received: true, handled: false });
  }

  // Tenancy comes from the row, never from Stripe. The token cross-check is
  // belt and braces: the session must have been started from a portal link
  // for this exact ticket.
  const rows = await query<{ shop_id: string; repair_order_id: string }>(
    `SELECT i.shop_id, i.repair_order_id
       FROM invoices i
      WHERE i.id = $1
        AND ($2::uuid IS NULL OR EXISTS (
              SELECT 1 FROM portal_tokens t
               WHERE t.id = $2 AND t.repair_order_id = i.repair_order_id AND t.shop_id = i.shop_id))`,
    [checkout.invoiceId, checkout.portalTokenId],
  );
  const invoice = rows[0];
  if (!invoice) {
    console.warn("[stripe] no invoice matches", checkout.invoiceId, checkout.portalTokenId);
    return Response.json({ received: true, handled: false });
  }

  const origin = await requestOrigin();
  const result = await tx((client) =>
    recordPayment(client, {
      invoiceId: checkout.invoiceId!,
      shopId: invoice.shop_id,
      amountCents: checkout.amountTotalCents,
      method: "card",
      provider: "stripe",
      providerRef: checkout.paymentIntentId ?? checkout.sessionId,
      origin,
    }),
  );

  return Response.json({
    received: true,
    handled: result.recorded || result.reason === "duplicate",
    duplicate: !result.recorded && result.reason === "duplicate",
  });
}
