import { removeLine, setLineApproval } from "@/app/actions/repair-orders";
import { AddLineForm } from "@/components/app/ro-forms";
import { Section, StatusBadge } from "@/components/app/ui";
import { query } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { totalsFor } from "@/lib/ro-totals";
import { LINE_KIND_LABEL, type Approval, type LineKind } from "@/lib/statuses";
import type { RoContext } from "./contracts";

/**
 * The lines: the money on the ticket, and the customer's answer to each.
 *
 * A pending line is a quote; an approved line is work; a declined line stays
 * as the record of what was offered but drops out of the total. The customer
 * answers from the estimate on their phone — or out loud at the counter,
 * which is what the two buttons on a pending line are for.
 */

interface Line {
  id: string;
  kind: LineKind;
  description: string;
  quantity: string;
  unit_cents: number;
  total_cents: number;
  quoted_by_agent: boolean;
  approval: Approval;
}

export async function LinesPanel({ ro }: { ro: RoContext }) {
  const lines = await query<Line>(
    `SELECT l.id, l.kind, l.description, l.quantity, l.unit_cents, l.total_cents,
            l.quoted_by_agent, l.approval
       FROM repair_order_lines l
       JOIN repair_orders r ON r.id = l.repair_order_id
      WHERE l.repair_order_id = $1 AND r.shop_id = $2
      ORDER BY l.position, l.created_at`,
    [ro.id, ro.shopId],
  );

  const totals = totalsFor(lines, ro.taxRatePct);
  const pending = lines.filter((line) => line.approval === "pending").length;
  const closed = ro.status === "closed" || ro.status === "cancelled";

  return (
    <Section
      id="lines"
      title="Lines"
      detail={
        lines.length === 0
          ? "Nothing on the ticket yet."
          : `${lines.length} ${lines.length === 1 ? "line" : "lines"}${
              pending > 0 ? ` · ${pending} awaiting an answer` : ""
            }`
      }
    >
      {lines.length === 0 ? (
        <p className="text-[0.875rem] text-ink-2">
          Labour is hours × your rate; a part is count × what you charge for it.
          New lines wait for the customer&rsquo;s yes.
        </p>
      ) : (
        <>
          {/*
            Six columns of numbers do not fit a phone, and a table scrolled
            sideways hides the money column — the one thing anybody opens a
            ticket to check. Below sm the same lines are stacked instead, with
            the total on the right of each one.
          */}
          <ul className="divide-y divide-line border-y border-line sm:hidden">
            {lines.map((line) => (
              <li key={line.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-[0.9375rem] text-ink ${line.approval === "declined" ? "line-through decoration-ink-3" : ""}`}>
                    {line.description}
                    {line.quoted_by_agent && <span className="tag tag-zol ml-2">ZOL</span>}
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] text-ink-3">
                    {LINE_KIND_LABEL[line.kind]}
                    {" · "}
                    <span className="t-data">
                      {Number(line.quantity)} × {formatCents(line.unit_cents)}
                    </span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusBadge kind="approval" value={line.approval} />
                    {!closed && <LineActions line={line} repairOrderId={ro.id} />}
                  </div>
                </div>
                <span className="t-data flex-none text-[0.9375rem] text-ink">
                  {formatCents(line.total_cents)}
                </span>
              </li>
            ))}
          </ul>

          <table className="hidden w-full text-left text-[0.875rem] sm:table">
            <thead>
              <tr className="border-b border-line">
                <th className="t-eyebrow pb-2 font-semibold">Kind</th>
                <th className="t-eyebrow pb-2 font-semibold">Description</th>
                <th className="t-eyebrow pb-2 text-right font-semibold">Qty</th>
                <th className="t-eyebrow pb-2 text-right font-semibold">Unit</th>
                <th className="t-eyebrow pb-2 text-right font-semibold">Total</th>
                <th className="t-eyebrow pb-2 pl-3 font-semibold">Answer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((line) => (
                <tr key={line.id} className={line.approval === "declined" ? "text-ink-3" : ""}>
                  <td className="py-2.5 text-ink-3">{LINE_KIND_LABEL[line.kind]}</td>
                  <td className={`py-2.5 text-ink ${line.approval === "declined" ? "line-through decoration-ink-3" : ""}`}>
                    {line.description}
                    {/* Emerald means ZOL did it with nobody watching — the
                        page's one colour system, used here too. */}
                    {line.quoted_by_agent && <span className="tag tag-zol ml-2">ZOL</span>}
                  </td>
                  <td className="t-data py-2.5 text-right text-ink-2">{Number(line.quantity)}</td>
                  <td className="t-data py-2.5 text-right text-ink-2">
                    {formatCents(line.unit_cents)}
                  </td>
                  <td className="t-data py-2.5 text-right text-ink">
                    {formatCents(line.total_cents)}
                  </td>
                  <td className="py-2.5 pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge kind="approval" value={line.approval} />
                      {!closed && <LineActions line={line} repairOrderId={ro.id} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="mt-3 flex flex-col gap-1 text-[0.875rem] sm:ml-auto sm:max-w-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-2">Subtotal</dt>
              <dd className="t-data text-ink">{formatCents(totals.subtotalCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-2">
                Tax, {ro.taxRatePct}% on {formatCents(totals.taxableCents)} of parts and fees
              </dt>
              <dd className="t-data flex-none text-ink">{formatCents(totals.taxCents)}</dd>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line-2 pt-2">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="t-data text-[1.0625rem] font-semibold text-ink">
                {formatCents(totals.totalCents)}
              </dd>
            </div>
            {lines.some((line) => line.approval === "declined") && (
              <p className="text-[0.75rem] text-ink-3">
                Declined lines stay on the ticket but are left out of the total — and they are on the recall list.
              </p>
            )}
          </dl>
        </>
      )}

      {!closed && (
        <div className="mt-6 border-t border-line pt-5">
          <AddLineForm
            key={lines.length}
            repairOrderId={ro.id}
            laborRate={(ro.laborRateCents / 100).toFixed(2)}
          />
        </div>
      )}
    </Section>
  );
}

/**
 * Approve or decline at the counter, and remove. A declined line goes onto
 * the recall list six months out on its own — the button says so, because a
 * "no" said at the counter is exactly the work that otherwise gets forgotten.
 */
function LineActions({ line, repairOrderId }: { line: Line; repairOrderId: string }) {
  return (
    <>
      {line.approval === "pending" && (
        <form action={setLineApproval} className="flex items-center gap-1.5">
          <input type="hidden" name="repair_order_id" value={repairOrderId} />
          <input type="hidden" name="line_id" value={line.id} />
          <button
            type="submit"
            name="approval"
            value="approved"
            className="text-[0.8125rem] font-semibold text-emerald-deep underline-offset-2 hover:underline"
            aria-label={`Approve ${line.description} at the counter`}
          >
            Approved at counter
          </button>
          <span className="text-ink-3" aria-hidden="true">
            ·
          </span>
          <button
            type="submit"
            name="approval"
            value="declined"
            className="text-[0.8125rem] font-semibold text-amber-deep underline-offset-2 hover:underline"
            aria-label={`Decline ${line.description} — goes on the recall list in six months`}
            title="Records it as declined work, to raise again in six months"
          >
            Declined
          </button>
        </form>
      )}
      <form action={removeLine}>
        <input type="hidden" name="line_id" value={line.id} />
        <input type="hidden" name="repair_order_id" value={repairOrderId} />
        <button
          type="submit"
          className="text-[0.8125rem] text-ink-3 underline-offset-2 hover:text-amber-deep hover:underline"
          aria-label={`Remove ${line.description}`}
        >
          Remove
        </button>
      </form>
    </>
  );
}
