import { notFound } from "next/navigation";

import { EstimateResponse } from "@/components/portal/estimate-response";
import { PortalInvoice } from "@/components/portal/invoice-section";
import { PortalMessageForm } from "@/components/portal/message-form";
import { PORTAL_EVENT_KINDS, PortalTimeline, plainStatus, type PortalEvent } from "@/components/portal/timeline";
import { MoneyRow, PortalCard, PortalNotice } from "@/components/portal/ui";
import { RatingDot } from "@/components/app/ui";
import { query, tx } from "@/lib/db";
import { env } from "@/lib/env";
import {
  expireEstimateIfDue,
  isEstimateExpired,
  latestEstimateForRepairOrder,
  markEstimateViewed,
} from "@/lib/estimates";
import { formatDateTime, formatMiles, formatWhen } from "@/lib/format";
import { invoiceForRepairOrder } from "@/lib/invoices";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { resolvePortalToken } from "@/lib/portal";
import { LINE_KIND_LABEL, RATING_LABEL, type LineKind, type Rating } from "@/lib/statuses";

/**
 * The customer's repair page.
 *
 * Public, keyed by the token in the URL, and the only screen in the product a
 * customer ever sees. Everything on it is scoped by what the token resolves
 * to — one shop, one customer, one ticket — and nothing on it is the shop's
 * internal view: no AI rankings, no supplier names, no margins. The
 * technician's *verified* diagnosis, the completed inspection, the estimate
 * to answer, the invoice to pay, and a way to write back.
 *
 * Order on the page follows what the customer most likely came to do: pay
 * if there's an invoice, answer if there's an estimate, otherwise see where
 * the car is.
 */
export default async function PortalPage(props: PageProps<"/portal/[token]">) {
  const { token } = await props.params;
  const view = await props.searchParams;
  const access = await resolvePortalToken(token);
  if (!access) notFound();

  const roRows = await query<{
    number: number;
    status: string;
    complaint: string | null;
    mileage_in: number | null;
    promised_at: string | null;
    checked_in_at: string | null;
    customer_name: string | null;
    vehicle: string | null;
    plate: string | null;
    shop_name: string;
    public_phone: string | null;
    address: string | null;
    timezone: string;
    tax_rate_pct: string;
  }>(
    `SELECT ro.number, ro.status, ro.complaint, ro.mileage_in,
            ro.promised_at::text, ro.checked_in_at::text,
            c.full_name AS customer_name,
            nullif(concat_ws(' ', v.year::text, v.make, v.model, v.trim), '') AS vehicle, v.plate,
            s.name AS shop_name, s.public_phone, s.address, s.timezone, s.tax_rate_pct
       FROM repair_orders ro
       JOIN customers c ON c.id = ro.customer_id
       JOIN shops s ON s.id = ro.shop_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      WHERE ro.id = $1 AND ro.shop_id = $2 AND ro.customer_id = $3`,
    [access.repairOrderId, access.shopId, access.customerId],
  );
  const ro = roRows[0];
  if (!ro) notFound();
  const tz = ro.timezone;

  // The estimate first, because opening this page is what "viewed" means.
  // One transaction: "viewed" is the status flip, the history row and the
  // shop's bell together, and the flip is guarded on viewed_at IS NULL — so
  // had it committed on its own and the bell then failed, nothing would ever
  // write the bell. Rolled back as one, the next open simply tries again.
  let latest = await latestEstimateForRepairOrder(access.shopId, access.repairOrderId);
  if (latest && (latest.estimate.status === "sent" || latest.estimate.status === "viewed")) {
    const { estimate } = latest;
    const changed = await tx(async (client) => {
      const expiredNow = await expireEstimateIfDue(client, { shopId: access.shopId, estimateId: estimate.id });
      if (!expiredNow && estimate.status === "sent") {
        await markEstimateViewed(client, { shopId: access.shopId, estimateId: estimate.id });
      }
      return expiredNow || estimate.status === "sent";
    });
    if (changed) {
      latest = await latestEstimateForRepairOrder(access.shopId, access.repairOrderId);
    }
  }

  const [events, inspection, diagnostic, messages, invoice] = await Promise.all([
    query<PortalEvent>(
      `SELECT id, kind, to_status, created_at::text
         FROM repair_order_events
        WHERE repair_order_id = $1 AND shop_id = $2 AND kind = ANY($3)
        ORDER BY created_at DESC
        LIMIT 40`,
      [access.repairOrderId, access.shopId, PORTAL_EVENT_KINDS],
    ),
    loadInspection(access.shopId, access.repairOrderId),
    query<{ obd_codes: string[]; verification: string; verified_at: string; technician: string | null }>(
      `SELECT d.obd_codes, d.verification, d.verified_at::text, s.full_name AS technician
         FROM diagnostics d
         LEFT JOIN staff s ON s.id = d.verified_by
        WHERE d.repair_order_id = $1 AND d.shop_id = $2
          AND d.verified_at IS NOT NULL AND d.verification IS NOT NULL
        ORDER BY d.verified_at DESC LIMIT 1`,
      [access.repairOrderId, access.shopId],
    ),
    // This ticket's messages plus the customer's ticket-less ones — a reply
    // sent from the shop's Messages page carries no ticket, and the customer
    // still needs to read it here. Never notes, never anything internal.
    query<{ id: string; direction: string; channel: string; body: string; created_at: string }>(
      `SELECT id, direction, channel, body, created_at::text
         FROM messages
        WHERE shop_id = $2 AND customer_id = $3
          AND (repair_order_id = $1 OR repair_order_id IS NULL)
          AND direction IN ('inbound', 'outbound')
          AND channel IN ('sms', 'portal', 'email')
        ORDER BY created_at ASC
        LIMIT 100`,
      [access.repairOrderId, access.shopId, access.customerId],
    ),
    invoiceForRepairOrder(access.shopId, access.repairOrderId),
  ]);

  const estimate = latest && latest.estimate.status !== "draft" ? latest : null;
  const estimateExpired = estimate ? isEstimateExpired(estimate.estimate) || estimate.estimate.status === "expired" : false;
  const estimateOpen =
    estimate && !estimateExpired && (estimate.estimate.status === "sent" || estimate.estimate.status === "viewed");
  const invoiceLive = invoice && invoice.invoice.status !== "void";
  const firstName = ro.customer_name?.split(" ")[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <header className="px-1">
        <p className="t-eyebrow">Your repair at</p>
        <h1 className="t-h2 mt-1 text-[1.75rem] text-ink">{ro.shop_name}</h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.9375rem] text-ink-2">
          {ro.public_phone && (
            <a href={`tel:${ro.public_phone}`} className="t-data font-medium text-ink underline-offset-4 hover:underline">
              {formatPhone(ro.public_phone)}
            </a>
          )}
          {ro.address && <span>{ro.address}</span>}
        </p>
      </header>

      {view.answered === "1" && (
        <PortalNotice tone="zol">Thanks{firstName ? `, ${firstName}` : ""} — your answer is with the shop.</PortalNotice>
      )}
      {view.sent === "1" && <PortalNotice tone="zol">Your message is with the shop.</PortalNotice>}

      <PortalCard>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-[1.0625rem] font-semibold text-ink">{ro.vehicle ?? "Your vehicle"}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-[0.8125rem] text-ink-3">
              {ro.plate && <span className="t-data">{ro.plate}</span>}
              {ro.mileage_in != null && <span className="t-data">{formatMiles(ro.mileage_in)}</span>}
              <span className="t-data">Ticket #{ro.number}</span>
            </p>
          </div>
          {firstName && <p className="text-[0.9375rem] text-ink-2">Hi {firstName}</p>}
        </div>
        <p className="mt-4 text-[1.25rem] font-semibold leading-snug text-emerald-deep">{plainStatus(ro.status)}</p>
        {ro.promised_at && !["ready", "closed", "cancelled"].includes(ro.status) && (
          <p className="mt-1 text-[0.9375rem] text-ink-2">
            Expected ready {formatWhen(ro.promised_at, tz)}.
          </p>
        )}
        {ro.complaint && (
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">
            <span className="text-ink-3">You told us: </span>
            {ro.complaint}
          </p>
        )}
      </PortalCard>

      {invoiceLive && (
        <PortalInvoice
          token={token}
          bundle={invoice}
          taxRatePct={ro.tax_rate_pct}
          timezone={tz}
          shopName={ro.shop_name}
          stripe={env.stripe.configured}
          view={{
            pay: typeof view.pay === "string" ? view.pay : undefined,
            paid: typeof view.paid === "string" ? view.paid : undefined,
            cancelled: typeof view.cancelled === "string" ? view.cancelled : undefined,
          }}
        />
      )}

      {estimate && (
        <PortalCard
          id="estimate"
          eyebrow={`Estimate #${estimate.estimate.number}`}
          title={
            estimateOpen
              ? "Please review and approve"
              : estimateExpired
                ? "This estimate has expired"
                : "Your answer"
          }
        >
          {estimate.estimate.note && (
            <p className="mb-4 whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-2">
              {estimate.estimate.note}
            </p>
          )}

          {estimateOpen ? (
            <EstimateResponse
              token={token}
              estimateId={estimate.estimate.id}
              number={estimate.estimate.number}
              taxRatePct={Number(ro.tax_rate_pct)}
              lines={estimate.lines.map((line) => ({
                id: line.id,
                description: line.description,
                kindLabel: LINE_KIND_LABEL[line.kind as LineKind] ?? line.kind,
                quantity: Number(line.quantity),
                unitCents: line.unit_cents,
                totalCents: line.total_cents,
                taxable: line.kind === "part" || line.kind === "fee",
              }))}
            />
          ) : estimateExpired ? (
            <PortalNotice tone="neutral">
              The window for answering this estimate has closed. Call {ro.shop_name}
              {ro.public_phone ? ` on ${formatPhone(ro.public_phone)}` : ""} and they&apos;ll send a fresh one.
            </PortalNotice>
          ) : (
            <AnsweredEstimate lines={estimate.lines} taxRatePct={ro.tax_rate_pct} respondedAt={estimate.estimate.responded_at} timezone={tz} />
          )}
        </PortalCard>
      )}

      {diagnostic[0] && (
        <PortalCard eyebrow="What we found" title="Diagnosis">
          {diagnostic[0].obd_codes.length > 0 && (
            <p className="mb-2 flex flex-wrap gap-1.5">
              {diagnostic[0].obd_codes.map((code) => (
                <span key={code} className="tag tag-neutral">
                  {code}
                </span>
              ))}
            </p>
          )}
          <p className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-2">
            {diagnostic[0].verification}
          </p>
          <p className="mt-2 text-[0.8125rem] text-ink-3">
            Confirmed by {diagnostic[0].technician ?? "the technician"} · {formatDateTime(diagnostic[0].verified_at, tz)}
          </p>
        </PortalCard>
      )}

      {inspection && (
        <PortalCard eyebrow="Inspection" title="How the rest of the car looks">
          {inspection.summary && (
            <p className="text-[0.9375rem] leading-relaxed text-ink-2">{inspection.summary}</p>
          )}
          {inspection.urgent.length > 0 && (
            <SummaryList title="Needs attention now" tone="red" items={inspection.urgent} />
          )}
          {inspection.recommended.length > 0 && (
            <SummaryList title="Recommended soon" tone="person" items={inspection.recommended} />
          )}
          {inspection.maintenance.length > 0 && (
            <SummaryList title="Routine upkeep" tone="neutral" items={inspection.maintenance} />
          )}
          {inspection.items.length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {inspection.items.map((item) => (
                <li key={item.id} className="flex items-start gap-3 py-2">
                  <RatingDot rating={item.rating} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9375rem] text-ink">
                      {item.category}
                      <span className="ml-2 text-[0.8125rem] text-ink-3">{RATING_LABEL[item.rating as Rating] ?? item.rating}</span>
                    </p>
                    {(item.notes || item.measurement) && (
                      <p className="text-[0.8125rem] text-ink-2">
                        {item.notes}
                        {item.notes && item.measurement ? " · " : ""}
                        {item.measurement && <span className="t-data">{item.measurement}</span>}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[0.8125rem] text-ink-3">
            Inspected {formatDateTime(inspection.completed_at, tz)}. Green is good, amber is worth watching, red needs attention.
          </p>
        </PortalCard>
      )}

      <PortalCard eyebrow="Progress" title="Where things are">
        <PortalTimeline events={events} timezone={tz} />
      </PortalCard>

      <PortalCard eyebrow="Messages" title="Between you and the shop">
        {messages.length > 0 ? (
          <ol className="mb-4 flex flex-col gap-2.5">
            {messages.map((message) => {
              const mine = message.direction === "inbound";
              return (
                <li key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[88%] rounded-[10px] px-3.5 py-2.5 text-[0.9375rem] leading-relaxed ${
                      mine ? "bg-emerald-wash text-ink" : "bg-paper-3 text-ink"
                    }`}
                  >
                    <p className="whitespace-pre-line break-words">{message.body}</p>
                    <p className="t-data mt-1 text-[0.6875rem] text-ink-3">
                      {mine ? "You" : ro.shop_name} · {formatDateTime(message.created_at, tz)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mb-4 text-[0.9375rem] text-ink-3">Updates from the shop will show here as the job moves.</p>
        )}
        <PortalMessageForm token={token} shopName={ro.shop_name} />
      </PortalCard>
    </div>
  );
}

// -----------------------------------------------------------------------------

function AnsweredEstimate({
  lines,
  taxRatePct,
  respondedAt,
  timezone,
}: {
  lines: { id: string; description: string; kind: string; total_cents: number; approval: string }[];
  taxRatePct: string;
  respondedAt: string | null;
  timezone: string;
}) {
  const approved = lines.filter((line) => line.approval === "approved");
  const subtotal = approved.reduce((sum, line) => sum + line.total_cents, 0);
  const taxable = approved
    .filter((line) => line.kind === "part" || line.kind === "fee")
    .reduce((sum, line) => sum + line.total_cents, 0);
  const tax = Math.round((taxable * Number(taxRatePct)) / 100);

  return (
    <>
      <ul className="divide-y divide-line border-y border-line">
        {lines.map((line) => (
          <li key={line.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className={`text-[0.9375rem] ${line.approval === "declined" ? "text-ink-3 line-through" : "text-ink"}`}>
              {line.description}
            </span>
            <span className="flex flex-none items-center gap-2">
              <span className={`tag ${line.approval === "approved" ? "tag-zol" : line.approval === "declined" ? "tag-neutral" : "tag-person"}`}>
                {line.approval === "approved" ? "Approved" : line.approval === "declined" ? "Not now" : "Pending"}
              </span>
              <span className="t-data text-[0.9375rem] text-ink">{formatCents(line.total_cents)}</span>
            </span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 flex flex-col gap-1.5">
        <MoneyRow label="Approved work" value={formatCents(subtotal)} />
        <MoneyRow label={`Tax (${taxRatePct}% on parts and fees)`} value={formatCents(tax)} />
        <MoneyRow label="Total" value={formatCents(subtotal + tax)} strong />
      </dl>
      {respondedAt && (
        <p className="mt-3 text-[0.8125rem] text-ink-3">
          Answered {formatDateTime(respondedAt, timezone)}. Changed your mind? Call the shop.
        </p>
      )}
    </>
  );
}

function SummaryList({ title, tone, items }: { title: string; tone: "red" | "person" | "neutral"; items: string[] }) {
  const color = tone === "red" ? "text-red-deep" : tone === "person" ? "text-amber-deep" : "text-ink-2";
  return (
    <div className="mt-3">
      <p className={`text-[0.8125rem] font-semibold ${color}`}>{title}</p>
      <ul className="mt-1 list-disc pl-5 text-[0.9375rem] leading-relaxed text-ink-2">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

interface PortalInspection {
  completed_at: string;
  summary: string | null;
  urgent: string[];
  recommended: string[];
  maintenance: string[];
  items: { id: string; category: string; rating: string; notes: string | null; measurement: string | null }[];
}

/** The latest completed inspection, with only the items that were actually rated. */
async function loadInspection(shopId: string, repairOrderId: string): Promise<PortalInspection | null> {
  const rows = await query<{
    id: string;
    completed_at: string;
    summary: { summary?: string; urgent?: string[]; recommended?: string[]; maintenance?: string[] } | null;
  }>(
    `SELECT id, completed_at::text, summary
       FROM inspections
      WHERE repair_order_id = $1 AND shop_id = $2 AND completed_at IS NOT NULL
      ORDER BY completed_at DESC LIMIT 1`,
    [repairOrderId, shopId],
  );
  const inspection = rows[0];
  if (!inspection) return null;

  const items = await query<PortalInspection["items"][number]>(
    `SELECT id, category, rating, notes, measurement
       FROM inspection_items
      WHERE inspection_id = $1 AND rating <> 'not_inspected'
      ORDER BY CASE rating WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, position`,
    [inspection.id],
  );

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  return {
    completed_at: inspection.completed_at,
    summary: typeof inspection.summary?.summary === "string" ? inspection.summary.summary : null,
    urgent: strings(inspection.summary?.urgent),
    recommended: strings(inspection.summary?.recommended),
    maintenance: strings(inspection.summary?.maintenance),
    items,
  };
}
