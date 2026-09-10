import Link from "next/link";

import { payInvoiceDemo, startPayment } from "@/app/actions/portal";
import { Submit } from "@/components/app/field";
import { formatDateTime } from "@/lib/format";
import { invoiceBalanceCents, type InvoiceBundle } from "@/lib/invoices";
import { formatCents } from "@/lib/money";
import { portalPath } from "@/lib/portal";
import { LINE_KIND_LABEL, PAYMENT_METHOD_LABEL, type LineKind } from "@/lib/statuses";
import { MoneyRow, PortalCard, PortalNotice } from "./ui";

/**
 * The invoice on the customer's page: what they owe, how to pay it, and — once
 * it's paid — the receipt.
 *
 * Two ways to pay and they never blur. With Stripe configured the button
 * opens Stripe's own page and the card never touches ZOL. Without it, the
 * button leads to a confirmation that says in so many words that this is a
 * demonstration and nothing is charged; the payment it records says 'demo'
 * everywhere it is shown.
 */
export function PortalInvoice({
  token,
  bundle,
  taxRatePct,
  timezone,
  shopName,
  stripe,
  view,
}: {
  token: string;
  bundle: InvoiceBundle;
  taxRatePct: string;
  timezone: string;
  shopName: string;
  /** Whether a real processor is configured. */
  stripe: boolean;
  view: { pay?: string; paid?: string; cancelled?: string };
}) {
  const { invoice, lines, payments } = bundle;
  const balance = invoiceBalanceCents(invoice);
  const paid = invoice.status === "paid";
  const voided = invoice.status === "void";
  const succeeded = payments.filter((payment) => payment.status === "succeeded");

  if (voided) return null;

  return (
    <PortalCard id="invoice" eyebrow={`Invoice #${invoice.number}`} title={paid ? "Paid — thank you" : "Your invoice"}>
      {view.paid === "1" && paid && (
        <div className="mb-4">
          <PortalNotice tone="zol">
            Payment received. This page is your receipt, and a copy is on its way to you.
          </PortalNotice>
        </div>
      )}
      {view.paid === "pending" && !paid && (
        <div className="mb-4">
          <PortalNotice tone="neutral">
            Thanks — your payment is being confirmed. This page will show it as paid in a moment; refresh if it hasn&apos;t.
          </PortalNotice>
        </div>
      )}
      {view.cancelled === "1" && !paid && (
        <div className="mb-4">
          <PortalNotice tone="neutral">No payment was taken. You can pay any time from here, or at the counter.</PortalNotice>
        </div>
      )}
      {view.pay === "failed" && (
        <div className="mb-4">
          <PortalNotice tone="red">
            We couldn&apos;t open the card payment page just now. Try again in a minute, or pay at the counter.
          </PortalNotice>
        </div>
      )}

      <ul className="divide-y divide-line border-y border-line">
        {lines.map((line) => (
          <li key={line.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[0.9375rem] text-ink">{line.description}</p>
              <p className="mt-0.5 text-[0.8125rem] text-ink-3">
                {LINE_KIND_LABEL[line.kind as LineKind] ?? line.kind}
                {" · "}
                <span className="t-data">
                  {Number(line.quantity)} × {formatCents(line.unit_cents)}
                </span>
              </p>
            </div>
            <span className="t-data flex-none text-[0.9375rem] text-ink">{formatCents(line.total_cents)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-3 flex flex-col gap-1.5">
        <MoneyRow label="Subtotal" value={formatCents(invoice.subtotal_cents)} />
        <MoneyRow label={`Tax (${taxRatePct}% on parts and fees)`} value={formatCents(invoice.tax_cents)} />
        <MoneyRow label="Total" value={formatCents(invoice.total_cents)} strong />
        {succeeded.length > 0 && <MoneyRow label="Paid" value={formatCents(invoice.paid_cents)} />}
        {!paid && <MoneyRow label="Balance due" value={formatCents(balance)} strong tone="person" />}
      </dl>

      {succeeded.length > 0 && (
        <div className="mt-4">
          <p className="t-eyebrow mb-1.5">Payments</p>
          <ul className="flex flex-col gap-1 text-[0.875rem] text-ink-2">
            {succeeded.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>
                  {PAYMENT_METHOD_LABEL[payment.method]}
                  {payment.provider === "demo" && (
                    <span className="tag tag-person ml-2 align-middle">Demo — nothing charged</span>
                  )}
                </span>
                <span className="t-data text-ink">
                  {formatCents(payment.amount_cents)} · {formatDateTime(payment.processed_at ?? payment.created_at, timezone)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {paid ? (
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-2">
          Paid in full{invoice.paid_at ? ` on ${formatDateTime(invoice.paid_at, timezone)}` : ""}. Thank you for
          choosing {shopName} — we&apos;ll check in with you in a few days to make sure everything is running right.
        </p>
      ) : view.pay === "confirm" && !stripe ? (
        <DemoConfirm token={token} balance={balance} />
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <form action={startPayment}>
            <input type="hidden" name="token" value={token} />
            <Submit className="btn btn-emerald w-full" pendingLabel="One moment…">
              Pay {formatCents(balance)}
            </Submit>
          </form>
          <p className="text-center text-[0.8125rem] leading-relaxed text-ink-3">
            {stripe
              ? "Card payments are handled by Stripe on their secure page. The shop never sees your card number."
              : "Or pay at the counter when you collect the vehicle."}
          </p>
        </div>
      )}
    </PortalCard>
  );
}

/**
 * The step between "Pay" and a demo payment. There is no ambiguity allowed
 * here: the customer is told, above the button, that no card is charged.
 */
function DemoConfirm({ token, balance }: { token: string; balance: number }) {
  return (
    <div className="mt-4 rounded-[var(--radius)] border border-amber-line bg-amber-wash p-4">
      <p className="text-[0.9375rem] font-semibold text-amber-deep">Demonstration payment</p>
      <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-2">
        This shop hasn&apos;t connected a card processor yet, so this button records a
        demonstration payment of {formatCents(balance)}. <strong className="text-ink">No card is charged
        and no money moves.</strong> Please settle up at the counter.
      </p>
      <form action={payInvoiceDemo} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="token" value={token} />
        <Submit className="btn btn-primary w-full" pendingLabel="Recording…">
          Record demo payment — nothing is charged
        </Submit>
        <Link href={portalPath(token)} className="btn btn-ghost w-full">
          Go back
        </Link>
      </form>
    </div>
  );
}
