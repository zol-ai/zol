import {
  createEstimate,
  recordCounterDecision,
  saveEstimateNote,
  sendEstimate,
} from "@/app/actions/estimates";
import { EmptyState, Notice, Section, StatusBadge } from "@/components/app/ui";
import { query } from "@/lib/db";
import {
  isEstimateExpired,
  listEstimatesForRepairOrder,
  type EstimateLineRow,
  type EstimateRow,
} from "@/lib/estimates";
import { formatDateTime, formatRelative } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { LINE_KIND_LABEL, type LineKind } from "@/lib/statuses";
import type { RoContext } from "./contracts";

/**
 * The estimate and the customer's answer, on the ticket.
 *
 * Newest estimate first. A draft is editable here — the note, then Send — and
 * a sent one shows what went out, when it was opened, and lets the advisor
 * record an answer given over the counter, line by line. The customer's own
 * answer arrives through the portal and shows up here the same way.
 */
export async function EstimatePanel({ ro }: { ro: RoContext }) {
  const [estimates, ticket, queued] = await Promise.all([
    listEstimatesForRepairOrder(ro.shopId, ro.id),
    query<{ live_lines: number; live_cents: number }>(
      `SELECT count(*)::int AS live_lines,
              coalesce(sum(total_cents), 0)::int AS live_cents
         FROM repair_order_lines
        WHERE repair_order_id = $1 AND approval <> 'declined'`,
      [ro.id],
    ),
    // The message that carried the link, so staff can pass it on by hand
    // while texting is switched off — or read it back to a customer who
    // says they never got it.
    query<{ body: string; status: string; created_at: string }>(
      `SELECT body, status, created_at::text
         FROM follow_ups
        WHERE repair_order_id = $1 AND shop_id = $2 AND kind = 'estimate_ready'
        ORDER BY created_at DESC LIMIT 1`,
      [ro.id, ro.shopId],
    ),
  ]);

  const liveLines = ticket[0]?.live_lines ?? 0;
  const open = estimates.find((entry) => ["draft", "sent", "viewed"].includes(entry.estimate.status));
  const closedTicket = ro.status === "closed" || ro.status === "cancelled";

  return (
    <Section
      id="estimates"
      title="Estimate"
      detail={
        estimates.length === 0
          ? "Nothing sent yet"
          : `${estimates.length} on this ticket`
      }
      action={
        closedTicket ? null : liveLines === 0 ? (
          <span className="text-[0.8125rem] text-ink-3">Add lines to the ticket first.</span>
        ) : (
          <form action={createEstimate}>
            <input type="hidden" name="repair_order_id" value={ro.id} />
            <button type="submit" className="btn btn-emerald btn-sm">
              {estimates.length === 0 ? "Create estimate" : "New estimate"}
            </button>
          </form>
        )
      }
      flush
    >
      {estimates.length === 0 ? (
        <EmptyState
          title="No estimate yet"
          detail={
            liveLines === 0
              ? "Put the work on the ticket as lines; the estimate is those lines, frozen, with a note the customer can follow."
              : `Create one to freeze the ${liveLines} line${liveLines === 1 ? "" : "s"} on the ticket and draft the customer's note.`
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {open && estimates.length > 1 && (
            <li className="px-4 py-2.5 sm:px-5">
              <p className="text-[0.8125rem] text-ink-3">
                The customer&apos;s page always shows the newest estimate; older ones stay here as the record.
              </p>
            </li>
          )}
          {estimates.map(({ estimate, lines }) => (
            <li key={estimate.id} className="px-4 py-4 sm:px-5">
              <EstimateCard
                ro={ro}
                estimate={estimate}
                lines={lines}
                queuedMessage={
                  estimate.id === estimates[0].estimate.id && estimate.status !== "draft"
                    ? (queued[0] ?? null)
                    : null
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// -----------------------------------------------------------------------------

function EstimateCard({
  ro,
  estimate,
  lines,
  queuedMessage,
}: {
  ro: RoContext;
  estimate: EstimateRow;
  lines: EstimateLineRow[];
  queuedMessage: { body: string; status: string; created_at: string } | null;
}) {
  const tz = ro.timezone;
  const expired = isEstimateExpired(estimate);
  const isDraft = estimate.status === "draft";
  const awaiting = !expired && (estimate.status === "sent" || estimate.status === "viewed");
  const answered = ["approved", "partial", "declined"].includes(estimate.status);
  const approvedCents = lines
    .filter((line) => line.approval === "approved")
    .reduce((sum, line) => sum + line.total_cents, 0);
  const pendingLines = lines.filter((line) => line.approval === "pending");

  return (
    <article>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="t-data text-[0.9375rem] font-semibold text-ink">
            Estimate #{estimate.number}
          </h3>
          <StatusBadge kind="estimate" value={expired ? "expired" : estimate.status} />
        </div>
        <p className="t-data text-[1.0625rem] font-semibold text-ink">
          {formatCents(estimate.total_cents)}
        </p>
      </header>

      <p className="mt-1 text-[0.8125rem] text-ink-3">
        {estimate.created_by_name ? `${estimate.created_by_name} · ` : ""}
        {isDraft
          ? `drafted ${formatDateTime(estimate.created_at, tz)}`
          : estimate.sent_at
            ? `sent ${formatDateTime(estimate.sent_at, tz)}`
            : ""}
        {estimate.viewed_at
          ? ` · opened ${formatDateTime(estimate.viewed_at, tz)}`
          : awaiting
            ? " · not opened yet"
            : ""}
        {estimate.responded_at ? ` · answered ${formatDateTime(estimate.responded_at, tz)}` : ""}
        {awaiting && estimate.expires_at ? ` · open until ${formatDateTime(estimate.expires_at, tz)}` : ""}
      </p>

      {/* Amber is "a person is needed": a viewed, unanswered estimate is exactly that. */}
      {awaiting && estimate.viewed_at && (
        <Notice tone="person" className="mt-3">
          Opened {formatRelative(estimate.viewed_at, tz)} and not answered. Worth a call.
        </Notice>
      )}
      {expired && (
        <Notice tone="neutral" className="mt-3">
          The customer&apos;s window closed without an answer. Create a new estimate to send it again.
        </Notice>
      )}

      {isDraft ? (
        <DraftForm estimate={estimate} smsOptedOut={ro.smsOptedOut} />
      ) : (
        estimate.note && (
          <blockquote className="mt-3 whitespace-pre-line rounded-[var(--radius)] border-l-2 border-line-2 bg-paper-2 px-3 py-2.5 text-[0.875rem] leading-relaxed text-ink-2">
            {estimate.note}
          </blockquote>
        )
      )}

      <Lines
        lines={lines}
        estimateId={estimate.id}
        counterActions={awaiting}
      />

      <dl className="mt-3 flex flex-col gap-1 text-[0.8125rem]">
        <Row label="Subtotal" value={formatCents(estimate.subtotal_cents)} />
        <Row label={`Tax, ${ro.taxRatePct}% on parts and fees`} value={formatCents(estimate.tax_cents)} />
        <Row label="Total quoted" value={formatCents(estimate.total_cents)} strong />
        {answered && (
          <Row
            label={`Approved work${estimate.status === "partial" ? ` (${lines.length - pendingLines.length - lines.filter((l) => l.approval === "declined").length} of ${lines.length} lines)` : ""}`}
            value={formatCents(approvedCents)}
            strong
          />
        )}
      </dl>

      {awaiting && pendingLines.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <p className="mr-auto text-[0.8125rem] text-ink-2">
            Heard from them in person?
          </p>
          <form action={recordCounterDecision}>
            <input type="hidden" name="estimate_id" value={estimate.id} />
            <input type="hidden" name="decision" value="approved" />
            <button type="submit" className="btn btn-ghost btn-sm">
              Approve all at counter
            </button>
          </form>
        </div>
      )}

      {queuedMessage && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="t-eyebrow mb-1">
            {queuedMessage.status === "sent" ? "Sent to the customer" : "Queued for the customer"}
          </p>
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">
            <Linkified text={queuedMessage.body} />
          </p>
          {ro.smsOptedOut && (
            <p className="mt-1 text-[0.8125rem] text-amber-deep">
              Texts are stopped for this customer — share the link another way.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function DraftForm({ estimate, smsOptedOut }: { estimate: EstimateRow; smsOptedOut: boolean }) {
  return (
    <form className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="estimate_id" value={estimate.id} />
      <label htmlFor={`note-${estimate.id}`} className="text-[0.8125rem] font-semibold text-ink-2">
        Note to the customer
      </label>
      <textarea
        id={`note-${estimate.id}`}
        name="note"
        rows={5}
        maxLength={2000}
        defaultValue={estimate.note ?? ""}
        className="input leading-relaxed"
      />
      <p className="text-[0.8125rem] text-ink-3">
        {estimate.note_source === "openai"
          ? "Drafted by ZOL from the diagnosis, the inspection and the lines. Read it before it goes out — it names the work and never sets a price."
          : estimate.note_source === "person"
            ? "Your wording. It goes out exactly as written."
            : "Template wording — built from the lines and the diagnosis without a model. Edit it before it goes out."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" formAction={sendEstimate} className="btn btn-emerald btn-sm">
          Send to customer
        </button>
        <button type="submit" formAction={saveEstimateNote} className="btn btn-ghost btn-sm">
          Save note
        </button>
        <span className="text-[0.8125rem] text-ink-3">
          {smsOptedOut
            ? "Sending moves the ticket to Needs approval. Texts are stopped for this customer, so nothing goes out — the link appears here for you to hand over."
            : "Sending texts the link (or posts it to their repair page while texting is off) and moves the ticket to Needs approval."}
        </span>
      </div>
    </form>
  );
}

function Lines({
  lines,
  estimateId,
  counterActions,
}: {
  lines: EstimateLineRow[];
  estimateId: string;
  counterActions: boolean;
}) {
  return (
    <ul className="mt-3 divide-y divide-line border-y border-line">
      {lines.map((line) => (
        <li key={line.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-2.5">
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
          <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto">
            <StatusBadge kind="approval" value={line.approval} />
            {counterActions && line.approval === "pending" && (
              <form action={recordCounterDecision} className="flex gap-1">
                <input type="hidden" name="estimate_id" value={estimateId} />
                <input type="hidden" name="line_id" value={line.id} />
                <button
                  type="submit"
                  name="decision"
                  value="approved"
                  className="btn btn-ghost btn-sm !min-h-0 !px-2.5 !py-1 text-[0.75rem]"
                  aria-label={`Record ${line.description} approved at the counter`}
                >
                  Yes
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="declined"
                  className="btn btn-ghost btn-sm !min-h-0 !px-2.5 !py-1 text-[0.75rem]"
                  aria-label={`Record ${line.description} declined at the counter`}
                >
                  No
                </button>
              </form>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "border-t border-line pt-1.5 font-semibold text-ink" : "text-ink-2"}`}>
      <dt>{label}</dt>
      <dd className="t-data text-ink">{value}</dd>
    </div>
  );
}

/** The queued message, with its portal URL made tappable. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="t-data break-all text-emerald-deep underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
