"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { formatCents, parseCents } from "@/lib/money";
import { notifyShop } from "@/lib/notifications";
import { recordPayment } from "@/lib/payments/provider";
import { requestOrigin } from "@/lib/request-origin";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/lib/statuses";

/**
 * A person recording money taken at the counter.
 *
 * Cash, a cheque, a card run on the shop's own terminal — none of it passes
 * through ZOL, so this records that it happened and lets `recordPayment` do
 * everything that follows (invoice status, ticket closed, receipt, the
 * three-day check-in). Stripe payments never come through here; the webhook
 * records those.
 *
 * The form itself bounds the amount (min a cent, max the balance) so the
 * browser refuses the obvious mistakes. The shape of what arrives is
 * re-checked here because a form is a suggestion, not a guarantee — but the
 * balance is not checked here at all. That comparison belongs under the
 * invoice's lock, in `recordPayment`, where a payment another device
 * recorded a second ago is visible; made out here it would pass twice and
 * mean nothing. When the lock refuses, the advisor is told why.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function recordManualPayment(form: FormData): Promise<void> {
  const user = await requireUser();
  const invoiceId = text(form, "invoice_id");
  const rawAmount = text(form, "amount");
  const method = text(form, "method") as PaymentMethod;
  const note = text(form, "note").slice(0, 500);

  const rows = await query<{ repair_order_id: string }>(
    `SELECT repair_order_id FROM invoices WHERE id = $1 AND shop_id = $2`,
    [invoiceId, user.shopId],
  );
  const invoice = rows[0];
  if (!invoice) redirect("/app/invoices");

  const ticket = `/app/repair-orders/${invoice.repair_order_id}`;
  const back = `${ticket}#invoice`;

  const amount = parseCents(rawAmount);
  if (amount === undefined || amount <= 0 || !PAYMENT_METHODS.includes(method)) {
    redirect(back);
  }

  const origin = await requestOrigin();

  const result = await tx(async (client) => {
    const outcome = await recordPayment(client, {
      invoiceId,
      shopId: user.shopId,
      amountCents: amount,
      method,
      provider: "manual",
      note: note || null,
      recordedBy: user.staffId,
      origin,
    });

    /*
      Refused under the lock. The page the advisor lands back on shows the
      other payment, not the refusal — and they may be holding the cash —
      so it is said to them by name, in their bell. Committed in the same
      transaction as the refusal, which wrote nothing else.
    */
    if (!outcome.recorded && (outcome.reason === "already_paid" || outcome.reason === "over_balance")) {
      const taken = `${formatCents(amount)} ${PAYMENT_METHOD_LABEL[method].toLowerCase()}`;
      await notifyShop(client, user.shopId, {
        kind: "payment",
        staffId: user.staffId,
        title:
          outcome.reason === "already_paid"
            ? `Payment not recorded — invoice #${outcome.invoiceNumber} was already paid`
            : `Payment not recorded — invoice #${outcome.invoiceNumber} only had ${formatCents(outcome.balanceCents)} owing`,
        body:
          outcome.reason === "already_paid"
            ? `Your ${taken} was not taken: another payment settled the invoice first. If money changed hands, it is a refund.`
            : `Your ${taken} was not taken: another payment landed first and this would have overpaid. Record ${formatCents(outcome.balanceCents)}, or refund the difference.`,
        href: back,
      });
    }
    return outcome;
  });

  revalidatePath(ticket);
  revalidatePath("/app/invoices");
  revalidatePath("/app/payments");
  // The reason rides in the URL so the ticket page can say it in place.
  redirect(result.recorded ? back : `${ticket}?pay=${result.reason}#invoice`);
}
