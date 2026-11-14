import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe over plain fetch — the same choice lib/twilio-signature.ts and
 * lib/ai/client.ts made. Two calls are all this product needs from Stripe:
 * open a Checkout Session for an invoice's balance, and prove that a webhook
 * really came from Stripe before believing it. Neither is worth an SDK.
 *
 * ZOL never sees a card. The customer types it on Stripe's page; what comes
 * back is a session id and, later, a signed event saying it was paid.
 */

// -----------------------------------------------------------------------------
// Checkout
// -----------------------------------------------------------------------------

export interface CheckoutSessionInput {
  secretKey: string;
  /** The balance, in cents. Stripe wants integer minor units too. */
  amountCents: number;
  /** "Invoice #3052 — Fifth Street Auto", shown on the Stripe page. */
  description: string;
  customerEmail?: string | null;
  invoiceId: string;
  /** The portal token that started the payment, so the webhook can cross-check. */
  portalTokenId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  id: string;
  /** Where to send the customer. */
  url: string;
}

/**
 * Create a Checkout Session and return where to send the customer.
 *
 * Throws on any failure — the portal action shows "couldn't reach the card
 * page" and leaves the demo path alone, because falling back to a pretend
 * payment when the real one failed would be the worst possible outcome.
 */
export async function createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(input.amountCents),
    "line_items[0][price_data][product_data][name]": input.description,
    "metadata[invoice_id]": input.invoiceId,
    "metadata[portal_token_id]": input.portalTokenId,
    // The same two keys on the PaymentIntent, so a charge found from the
    // Stripe dashboard still points back at the invoice.
    "payment_intent_data[metadata][invoice_id]": input.invoiceId,
    "payment_intent_data[metadata][portal_token_id]": input.portalTokenId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  if (input.customerEmail) body.set("customer_email", input.customerEmail);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };

  if (!response.ok || !payload.id || !payload.url) {
    throw new Error(
      `Stripe checkout session failed (${response.status}): ${payload.error?.message ?? "no session returned"}`,
    );
  }

  return { id: payload.id, url: payload.url };
}

// -----------------------------------------------------------------------------
// Webhook signatures
// -----------------------------------------------------------------------------

/** Stripe's default tolerance for the timestamp in the signature. */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Pull `t` and every `v1` out of a `Stripe-Signature` header.
 *
 * The header is `t=<unix seconds>,v1=<hex>,v1=<hex>` — more than one v1
 * during a secret rotation. Anything malformed comes back as null rather
 * than as a partially filled object a caller might accept.
 */
export function parseStripeSignature(header: string | null): { timestamp: number; signatures: string[] } | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (!/^\d+$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "v1" && /^[0-9a-f]+$/i.test(value)) {
      signatures.push(value.toLowerCase());
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * True when the header proves Stripe signed this exact body with our secret
 * recently enough.
 *
 * Stripe signs `${t}.${rawBody}` with HMAC-SHA256 under the endpoint secret.
 * The body has to be the bytes as received — re-serialising the JSON changes
 * whitespace and the signature with it, which is why the route reads
 * `request.text()` and never `request.json()`. Comparison is constant-time.
 *
 * Reference: https://docs.stripe.com/webhooks#verify-manually
 */
export function verifyStripeSignature({
  payload,
  header,
  secret,
  toleranceSeconds = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
  now = new Date(),
}: {
  payload: string;
  header: string | null;
  secret: string;
  toleranceSeconds?: number;
  now?: Date;
}): boolean {
  if (!secret) return false;
  const parsed = parseStripeSignature(header);
  if (!parsed) return false;

  const age = Math.floor(now.getTime() / 1000) - parsed.timestamp;
  if (Math.abs(age) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${payload}`, "utf8")
    .digest();

  return parsed.signatures.some((candidate) => {
    let provided: Buffer;
    try {
      provided = Buffer.from(candidate, "hex");
    } catch {
      return false;
    }
    // timingSafeEqual throws on a length mismatch, so guard before comparing.
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

/** Builds a header the way Stripe does — for tests, and for local replay. */
export function signStripePayload(payload: string, secret: string, timestamp: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

// -----------------------------------------------------------------------------
// The one event we act on
// -----------------------------------------------------------------------------

export interface CompletedCheckout {
  sessionId: string;
  paymentIntentId: string | null;
  amountTotalCents: number;
  paymentStatus: string;
  invoiceId: string | null;
  portalTokenId: string | null;
}

/**
 * Pick the fields out of a `checkout.session.completed` event body, or null
 * for any other event or a shape that doesn't carry what we need. Nothing
 * here is trusted for tenancy — the route looks the invoice up by id and
 * takes the shop from the row, not from Stripe.
 */
export function readCompletedCheckout(event: unknown): CompletedCheckout | null {
  if (!event || typeof event !== "object") return null;
  const e = event as { type?: unknown; data?: { object?: unknown } };
  if (e.type !== "checkout.session.completed") return null;
  const session = e.data?.object;
  if (!session || typeof session !== "object") return null;

  const s = session as {
    id?: unknown;
    payment_intent?: unknown;
    amount_total?: unknown;
    payment_status?: unknown;
    metadata?: { invoice_id?: unknown; portal_token_id?: unknown };
  };
  if (typeof s.id !== "string" || typeof s.amount_total !== "number") return null;

  return {
    sessionId: s.id,
    paymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : null,
    amountTotalCents: s.amount_total,
    paymentStatus: typeof s.payment_status === "string" ? s.payment_status : "unknown",
    invoiceId: typeof s.metadata?.invoice_id === "string" ? s.metadata.invoice_id : null,
    portalTokenId:
      typeof s.metadata?.portal_token_id === "string" ? s.metadata.portal_token_id : null,
  };
}
