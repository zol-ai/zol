import "server-only";

import type { Queryable } from "@/lib/db";
import { logRoEvent } from "@/lib/events";
import { journeyMessage, queueFollowUp } from "@/lib/follow-ups";
import { invoiceStatusFor } from "@/lib/invoices";
import { formatCents } from "@/lib/money";
import { notifyShop } from "@/lib/notifications";
import { mintPortalToken, portalPath } from "@/lib/portal";
import { setRepairOrderStatus } from "@/lib/repair-orders-db";
import { PAYMENT_METHOD_LABEL, type PaymentMethod, type PaymentProvider } from "@/lib/statuses";

/**
 * Money arriving against an invoice, from any direction.
 *
 * Three things put a payment row in the table — Stripe's webhook, the demo
 * button on the portal, and an advisor typing "cash, $228.90" at the counter
 * — and the consequences are identical: the invoice's paid total and status
 * move, and when it is paid in full the ticket closes, the customer gets a
 * receipt, the shop gets a bell, and a "how's it running" goes on the
 * calendar for three days out. So all three call this, inside whatever
 * transaction they are already in.
 *
 * Idempotent on `provider_ref`: Stripe delivers a webhook at least once, and
 * the partial unique index in 0010 turns the second delivery into a 23505,
 * which is caught here and reported as "already recorded" rather than
 * charging the customer's invoice twice.
 *
 * Bounded by the balance, under the invoice's row lock. A manual payment has
 * no provider_ref for the index to catch, so the only thing between two
 * advisors both recording the same $228.90 and an invoice paid twice over is
 * the comparison made here, after the lock, against the rows — never the one
 * a caller made before it.
 */

/** Days after payment before ZOL asks how the car is running. */
const POST_REPAIR_DAYS = 3;

export interface RecordPaymentInput {
  invoiceId: string;
  shopId: string;
  amountCents: number;
  method: PaymentMethod;
  provider: PaymentProvider;
  /** Stripe's payment intent or session id. Never a card number. */
  providerRef?: string | null;
  note?: string | null;
  /** The person at the counter, when there was one. */
  recordedBy?: string | null;
  /** Public origin for the receipt's portal link. */
  origin: string;
}

export type RecordPaymentResult =
  | {
      recorded: true;
      paymentId: string;
      invoiceNumber: number;
      repairOrderId: string;
      /** The invoice's status after this payment. */
      status: "open" | "partial" | "paid";
      paidCents: number;
      totalCents: number;
      /** True when this payment is the one that settled it. */
      settled: boolean;
    }
  | { recorded: false; reason: "duplicate" | "no_invoice" | "void" | "bad_amount" }
  /** Refused under the lock: the invoice had less room than the caller believed. */
  | {
      recorded: false;
      reason: "already_paid" | "over_balance";
      invoiceNumber: number;
      /** What was actually still owing when this payment arrived. */
      balanceCents: number;
    };

/** The live paid total, from the rows — never from the stored number. */
const PAID_SUM = `SELECT coalesce(sum(amount_cents), 0)::int AS paid
                    FROM payments WHERE invoice_id = $1 AND status = 'succeeded'`;

export async function recordPayment(
  client: Queryable,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { recorded: false, reason: "bad_amount" };
  }

  // Lock the invoice for the duration: two payments landing at once must
  // each see the other's contribution to paid_cents, or a $100 invoice paid
  // $60 + $60 by two devices reads as "partial" forever.
  const { rows: invoices } = await client.query<{
    id: string;
    number: number;
    status: string;
    total_cents: number;
    repair_order_id: string;
    customer_id: string;
    vehicle_id: string | null;
    ro_number: number;
    ro_status: string;
    full_name: string | null;
    sms_opted_out: boolean;
    vehicle: string | null;
    shop_name: string;
    public_phone: string | null;
  }>(
    `SELECT i.id, i.number, i.status, i.total_cents, i.repair_order_id, i.customer_id,
            i.vehicle_id, ro.number AS ro_number, ro.status AS ro_status,
            c.full_name, c.sms_opted_out,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
            s.name AS shop_name, s.public_phone
       FROM invoices i
       JOIN repair_orders ro ON ro.id = i.repair_order_id
       JOIN customers c ON c.id = i.customer_id
       JOIN shops s ON s.id = i.shop_id
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
      WHERE i.id = $1 AND i.shop_id = $2
      FOR UPDATE OF i`,
    [input.invoiceId, input.shopId],
  );
  const invoice = invoices[0];
  if (!invoice) return { recorded: false, reason: "no_invoice" };
  if (invoice.status === "void") return { recorded: false, reason: "void" };

  /*
    Whatever a caller checked, it checked before this lock, against a total
    another device may already have moved — two advisors both recording the
    same $228.90 both pass, and the invoice reads paid twice over while the
    month's revenue counts it twice. Re-read here, where the other's row is
    visible, and refuse what would carry the invoice past its total. Stripe
    is the one exception: by the time its webhook lands the card has been
    charged, so the row is kept — the ledger has to match the money — and
    the bell below says a refund is owed instead of pretending otherwise.
  */
  const { rows: before } = await client.query<{ paid: number }>(PAID_SUM, [input.invoiceId]);
  const paidBefore = before[0]?.paid ?? 0;
  const balanceBefore = invoice.total_cents - paidBefore;
  const overshoots = invoice.status === "paid" || input.amountCents > balanceBefore;
  if (overshoots && input.provider !== "stripe") {
    return {
      recorded: false,
      reason: invoice.status === "paid" || balanceBefore <= 0 ? "already_paid" : "over_balance",
      invoiceNumber: invoice.number,
      balanceCents: Math.max(0, balanceBefore),
    };
  }

  let paymentId: string;
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO payments
         (shop_id, invoice_id, amount_cents, method, provider, provider_ref,
          status, note, recorded_by, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7, $8, now())
       RETURNING id`,
      [
        input.shopId,
        input.invoiceId,
        input.amountCents,
        input.method,
        input.provider,
        input.providerRef ?? null,
        input.note ?? null,
        input.recordedBy ?? null,
      ],
    );
    paymentId = rows[0].id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { recorded: false, reason: "duplicate" };
    }
    throw error;
  }

  // Recompute from the rows rather than adding to the stored number, so a
  // refund or a failed row edited by hand can never leave the two disagreeing.
  const { rows: sums } = await client.query<{ paid: number }>(PAID_SUM, [input.invoiceId]);
  const paidCents = sums[0]?.paid ?? 0;
  const status = invoiceStatusFor(invoice.total_cents, paidCents);
  const settled = status === "paid" && invoice.status !== "paid";
  // Only Stripe can get here past the total (see above): somebody is owed a refund.
  const overpaidCents = Math.max(0, paidCents - invoice.total_cents);

  await client.query(
    `UPDATE invoices
        SET paid_cents = $3, status = $4,
            paid_at = CASE WHEN $4 = 'paid' THEN coalesce(paid_at, now()) ELSE NULL END
      WHERE id = $1 AND shop_id = $2`,
    [input.invoiceId, input.shopId, paidCents, status],
  );

  const actor: "zol" | "person" = input.recordedBy ? "person" : "zol";
  const how =
    input.provider === "stripe"
      ? "card via Stripe"
      : input.provider === "demo"
        ? "demo card — no charge made"
        : PAYMENT_METHOD_LABEL[input.method].toLowerCase();

  await logRoEvent(client, {
    shopId: input.shopId,
    repairOrderId: invoice.repair_order_id,
    kind: "payment_recorded",
    detail:
      `Payment of ${formatCents(input.amountCents)} recorded (${how}) against invoice #${invoice.number}` +
      (overpaidCents > 0
        ? ` — ${formatCents(overpaidCents)} over the total; refund owed.`
        : status === "paid"
          ? "."
          : ` — ${formatCents(invoice.total_cents - paidCents)} still owing.`),
    actor,
    staffId: input.recordedBy ?? null,
  });

  if (settled) {
    // Paid means gone: the ticket closes. The low-level move, because the
    // receipt below is this flow's own message to the customer.
    if (invoice.ro_status !== "closed" && invoice.ro_status !== "cancelled") {
      await setRepairOrderStatus(client, {
        shopId: input.shopId,
        repairOrderId: invoice.repair_order_id,
        status: "closed",
        actor,
        staffId: input.recordedBy ?? null,
        detail: `Invoice #${invoice.number} paid in full — ticket closed.`,
      });
    }

    if (!invoice.sms_opted_out) {
      // A fresh link: only the hash of the old one is stored, so there is no
      // way to reuse it, and the receipt should land on the paid view anyway.
      const portalUrl =
        input.origin +
        portalPath(
          await mintPortalToken(client, {
            shopId: input.shopId,
            customerId: invoice.customer_id,
            repairOrderId: invoice.repair_order_id,
          }),
        );
      const ctx = {
        shopName: invoice.shop_name,
        shopPhone: invoice.public_phone,
        firstName: invoice.full_name?.split(" ")[0] ?? null,
        vehicle: invoice.vehicle,
        roNumber: invoice.ro_number,
      };

      const receipt = journeyMessage("payment_receipt", {
        ...ctx,
        portalUrl,
        totalCents: paidCents,
      });
      await queueFollowUp(client, {
        shopId: input.shopId,
        customerId: invoice.customer_id,
        repairOrderId: invoice.repair_order_id,
        vehicleId: invoice.vehicle_id,
        kind: "payment_receipt",
        title: receipt.title,
        body: receipt.body,
        source: actor,
      });

      const checkIn = journeyMessage("post_repair", ctx);
      await queueFollowUp(client, {
        shopId: input.shopId,
        customerId: invoice.customer_id,
        repairOrderId: invoice.repair_order_id,
        vehicleId: invoice.vehicle_id,
        kind: "post_repair",
        title: checkIn.title,
        details: `Paid invoice #${invoice.number}. Ask how the ${invoice.vehicle ?? "car"} is running.`,
        body: checkIn.body,
        scheduledFor: new Date(Date.now() + POST_REPAIR_DAYS * 86_400_000),
        source: "zol",
      });
    }
  }

  await notifyShop(client, input.shopId, {
    kind: "payment",
    title:
      overpaidCents > 0
        ? `Invoice #${invoice.number} overpaid by ${formatCents(overpaidCents)} — refund owed`
        : settled
          ? `Invoice #${invoice.number} paid — #${invoice.ro_number} closed`
          : `${formatCents(input.amountCents)} received on invoice #${invoice.number}`,
    body:
      `${invoice.full_name ?? "Customer"} · ${formatCents(input.amountCents)} ${how}` +
      (overpaidCents > 0
        ? ` landed on top of ${formatCents(paidBefore)} already received · refund the difference in Stripe`
        : status === "paid"
          ? ""
          : ` · ${formatCents(invoice.total_cents - paidCents)} still owing`),
    href: `/app/repair-orders/${invoice.repair_order_id}`,
  });

  return {
    recorded: true,
    paymentId,
    invoiceNumber: invoice.number,
    repairOrderId: invoice.repair_order_id,
    status,
    paidCents,
    totalCents: invoice.total_cents,
    settled,
  };
}
