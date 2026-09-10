import { createInvoice, voidInvoiceAction } from "@/app/actions/invoices";
import { recordManualPayment } from "@/app/actions/payments";
import { Select, Submit } from "@/components/app/field";
import { EmptyState, Notice, Section, StatusBadge, Tag } from "@/components/app/ui";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate, formatDateTime } from "@/lib/format";
import { invoiceBalanceCents, invoiceForRepairOrder, type PaymentRow } from "@/lib/invoices";
import { formatCents } from "@/lib/money";
import { totalsFor } from "@/lib/ro-totals";
import {
  LINE_KIND_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  type LineKind,
} from "@/lib/statuses";
import type { RoContext } from "./contracts";

/**
 * The invoice and the payments against it, on the ticket.
 *
 * Until there is one: what would be on it (the approved lines) and the button
 * to freeze them. Once there is one: the number, what's owed, what's been
 * paid and how, and the form for recording money taken at the counter. Card
 * payments from the portal arrive on their own — Stripe when it's configured,
 * the labelled demo when it isn't — and appear in the same list.
 */
export async function InvoicePanel({ ro }: { ro: RoContext }) {
  const [bundle, approved, payLink] = await Promise.all([
    invoiceForRepairOrder(ro.shopId, ro.id),
    query<{ kind: string; total_cents: number }>(
      `SELECT kind, total_cents FROM repair_order_lines
        WHERE repair_order_id = $1 AND approval = 'approved'`,
      [ro.id],
    ),
    // The customer's pay link travels in the "ready" message. Surfaced here
    // for the same reason the estimate panel shows its link: while texting
    // is off, a person may need to hand it over.
    query<{ body: string }>(
      `SELECT body FROM follow_ups
        WHERE repair_order_id = $1 AND shop_id = $2
          AND kind IN ('ready_for_pickup', 'payment_receipt')
          AND body LIKE '%/portal/%'
        ORDER BY created_at DESC LIMIT 1`,
      [ro.id, ro.shopId],
    ),
  ]);

  const approvedTotals = totalsFor(approved, ro.taxRatePct);
  const canCreate = approved.length > 0 && (!bundle || bundle.invoice.status === "void");

  if (!bundle || (bundle.invoice.status === "void" && canCreate)) {
    return (
      <Section
        id="invoice"
        title="Invoice"
        detail={bundle ? `#${bundle.invoice.number} was voided` : "Not created yet"}
        action={
          canCreate && (
            <form action={createInvoice}>
              <input type="hidden" name="repair_order_id" value={ro.id} />
              <button type="submit" className="btn btn-emerald btn-sm">
                {bundle ? "Reissue invoice" : "Create invoice"}
              </button>
            </form>
          )
        }
        flush
      >
        {approved.length === 0 ? (
          <EmptyState
            title="Nothing approved to bill"
            detail="An invoice is the approved lines, frozen. Once the customer has said yes to something — on their phone or at the counter — it can be created here."
          />
        ) : (
          <div className="px-4 py-4 sm:px-5">
            {bundle && (
              <Notice tone="neutral" className="mb-3">
                Invoice #{bundle.invoice.number} was voided. Reissuing writes a fresh number
                over it; the void stays on the ticket&apos;s history.
              </Notice>
            )}
            <p className="text-[0.875rem] text-ink-2">
              {approved.length} approved line{approved.length === 1 ? "" : "s"} —{" "}
              <span className="t-data text-ink">{formatCents(approvedTotals.subtotalCents)}</span>
              {" + "}
              <span className="t-data text-ink">{formatCents(approvedTotals.taxCents)}</span> tax ={" "}
              <span className="t-data font-semibold text-ink">{formatCents(approvedTotals.totalCents)}</span>.
              Pending lines are left off; declined ones never make it on.
            </p>
          </div>
        )}
      </Section>
    );
  }

  const { invoice, lines, payments } = bundle;
  const balance = invoiceBalanceCents(invoice);
  const tz = ro.timezone;
  const link = payLink[0]?.body.match(/https?:\/\/\S+/)?.[0] ?? null;

  return (
    <Section
      id="invoice"
      title={`Invoice #${invoice.number}`}
      detail={
        invoice.status === "paid" && invoice.paid_at
          ? `Paid in full ${formatDateTime(invoice.paid_at, tz)}`
          : invoice.status === "void"
            ? "Voided"
            : invoice.due_at
              ? `Due ${formatDate(invoice.due_at, tz)}`
              : undefined
      }
      action={<StatusBadge kind="invoice" value={invoice.status} />}
      flush
    >
      <div className="px-4 py-4 sm:px-5">
        <ul className="divide-y divide-line border-y border-line">
          {lines.map((line) => (
            <li key={line.id} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] text-ink">{line.description}</p>
                <p className="mt-0.5 text-[0.8125rem] text-ink-3">
                  {LINE_KIND_LABEL[line.kind as LineKind] ?? line.kind}
                  {" · "}
                  <span className="t-data">
                    {Number(line.quantity)} × {formatCents(line.unit_cents)}
                  </span>
                </p>
              </div>
              <span className="t-data text-[0.9375rem] text-ink">{formatCents(line.total_cents)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 flex flex-col gap-1 text-[0.8125rem]">
          <Row label="Subtotal" value={formatCents(invoice.subtotal_cents)} />
          <Row label={`Tax, ${ro.taxRatePct}% on parts and fees`} value={formatCents(invoice.tax_cents)} />
          <Row label="Total" value={formatCents(invoice.total_cents)} strong />
          <Row label="Paid" value={formatCents(invoice.paid_cents)} />
          <Row
            label="Balance"
            value={formatCents(balance)}
            strong
            tone={balance > 0 && invoice.status !== "void" ? "person" : "zol"}
          />
        </dl>
      </div>

      <div className="border-t border-line px-4 py-4 sm:px-5">
        <h3 className="t-eyebrow mb-2">Payments</h3>
        {payments.length === 0 ? (
          <p className="text-[0.875rem] text-ink-3">Nothing received yet.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {payments.map((payment) => (
              <PaymentItem key={payment.id} payment={payment} timezone={tz} />
            ))}
          </ul>
        )}
      </div>

      {invoice.status === "paid" && (
        <div className="border-t border-line px-4 py-4 sm:px-5">
          <Notice tone="zol">
            Paid in full. The ticket closed, the receipt went to the customer, and a
            &ldquo;how&apos;s it running&rdquo; check-in is queued for three days out.
          </Notice>
        </div>
      )}

      {invoice.status === "void" && (
        <div className="border-t border-line px-4 py-4 sm:px-5">
          <Notice tone="neutral">
            Voided. Nothing more can be recorded against this number.
          </Notice>
        </div>
      )}

      {balance > 0 && invoice.status !== "void" && (
        <div className="border-t border-line px-4 py-4 sm:px-5">
          <h3 className="t-eyebrow mb-3">Record a payment</h3>
          <form action={recordManualPayment} className="flex flex-col gap-3">
            <input type="hidden" name="invoice_id" value={invoice.id} />
            {/*
              Two fields side by side even on a phone: the amount is almost
              always the balance (it's prefilled) and the method is one tap.
              The browser holds the amount inside the balance; `recordPayment`
              re-checks it under the invoice's lock, because a form is a
              suggestion and the balance may have moved since this rendered.
            */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="payment-amount" className="text-[0.8125rem] font-semibold text-ink-2">
                  Amount
                </label>
                <input
                  id="payment-amount"
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  max={(balance / 100).toFixed(2)}
                  required
                  defaultValue={(balance / 100).toFixed(2)}
                  className="input t-data"
                />
              </div>
              <Select label="Method" name="method" defaultValue="cash">
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABEL[method]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="payment-note" className="text-[0.8125rem] font-semibold text-ink-2">
                Note <span className="font-normal text-ink-3">(optional)</span>
              </label>
              <input
                id="payment-note"
                name="note"
                maxLength={500}
                placeholder="Cheque #1042, paid by her husband…"
                className="input"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Submit className="btn btn-emerald btn-sm" pendingLabel="Recording…">
                Record payment
              </Submit>
              <span className="text-[0.8125rem] text-ink-3">
                Money taken here at the counter. Portal card payments record themselves.
              </span>
            </div>
          </form>

          {invoice.paid_cents === 0 && (
            <form action={voidInvoiceAction} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <input type="hidden" name="invoice_id" value={invoice.id} />
              <button type="submit" className="btn btn-ghost btn-sm">
                Void invoice
              </button>
              <span className="text-[0.8125rem] text-ink-3">
                Only while nothing has been paid against it. A corrected one can be reissued afterwards.
              </span>
            </form>
          )}

          {link && (
            <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] text-ink-2">
              Customer&apos;s pay link:{" "}
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="t-data break-all text-emerald-deep underline underline-offset-2"
              >
                {link}
              </a>
              {!env.stripe.configured && (
                <span className="text-ink-3"> · demo payments only — no card processor is configured.</span>
              )}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

// -----------------------------------------------------------------------------

function Row({
  label,
  value,
  strong = false,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "person" | "zol";
}) {
  const color = tone === "person" ? "text-amber-deep" : tone === "zol" ? "text-emerald-deep" : "text-ink";
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "border-t border-line pt-1.5 font-semibold" : "text-ink-2"}`}>
      <dt className={strong ? "text-ink" : ""}>{label}</dt>
      <dd className={`t-data ${strong ? color : "text-ink"}`}>{value}</dd>
    </div>
  );
}

/** One row of the payments list, shared with the payments index. */
export function PaymentItem({ payment, timezone }: { payment: PaymentRow; timezone: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <span className="t-data text-[0.9375rem] font-semibold text-ink">
        {formatCents(payment.amount_cents)}
      </span>
      <Tag tone="neutral">{PAYMENT_METHOD_LABEL[payment.method]}</Tag>
      <ProviderTag provider={payment.provider} />
      <StatusBadge kind="payment" value={payment.status} />
      <span className="ml-auto text-[0.8125rem] text-ink-3">
        {formatDateTime(payment.processed_at ?? payment.created_at, timezone)}
        {payment.recorded_by_name ? ` · ${payment.recorded_by_name}` : payment.provider === "manual" ? "" : " · ZOL"}
      </span>
      {payment.note && <p className="w-full text-[0.8125rem] text-ink-2">{payment.note}</p>}
    </li>
  );
}

/** Demo is amber on purpose: nobody should mistake it for money. */
export function ProviderTag({ provider }: { provider: PaymentRow["provider"] }) {
  if (provider === "stripe") return <Tag tone="blue">Stripe</Tag>;
  if (provider === "demo") return <Tag tone="person">Demo — no charge</Tag>;
  return <Tag tone="neutral">At the counter</Tag>;
}
