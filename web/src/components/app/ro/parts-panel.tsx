import { setPartStatus } from "@/app/actions/parts";
import { AddPartForm } from "@/components/app/ro-forms";
import { Section, StatusBadge, Tag } from "@/components/app/ui";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { PART_STATUS_LABEL, type PartStatus } from "@/lib/statuses";
import type { RoContext } from "./contracts";

/**
 * Parts on the ticket: what's needed, what's on order, what's on the shelf.
 *
 * Each row shows its status and the one or two buttons that move it along.
 * The ticket follows the parts on its own — ordering parks it, the last
 * arrival unparks it — and that logic lives in the action, not here.
 */

interface PartRow {
  id: string;
  name: string;
  part_number: string | null;
  supplier: string | null;
  quantity: number;
  unit_cost_cents: number;
  unit_price_cents: number;
  status: PartStatus;
  ordered_at: string | null;
  expected_at: string | null;
  received_at: string | null;
  installed_at: string | null;
  notes: string | null;
  line_description: string | null;
  overdue: boolean;
}

/** The next move(s) from each status. The first is the expected one. */
const NEXT: Record<PartStatus, PartStatus[]> = {
  needed: ["requested", "ordered"],
  requested: ["ordered"],
  ordered: ["received", "returned"],
  received: ["installed", "returned"],
  installed: [],
  returned: [],
};

const MOVE_LABEL: Record<PartStatus, string> = {
  needed: "Needed",
  requested: "Requested",
  ordered: "Ordered",
  received: "Received",
  installed: "Installed",
  returned: "Returned",
};

export async function PartsPanel({ ro }: { ro: RoContext }) {
  const [parts, lines] = await Promise.all([
    query<PartRow>(
      `SELECT p.id, p.name, p.part_number, p.supplier, p.quantity,
              p.unit_cost_cents, p.unit_price_cents, p.status,
              p.ordered_at::text, p.expected_at::text, p.received_at::text, p.installed_at::text,
              p.notes, l.description AS line_description,
              (p.expected_at IS NOT NULL AND p.expected_at < now()
               AND p.status IN ('needed', 'requested', 'ordered')) AS overdue
         FROM parts p
         LEFT JOIN repair_order_lines l ON l.id = p.repair_order_line_id
        WHERE p.repair_order_id = $1 AND p.shop_id = $2
        ORDER BY p.created_at`,
      [ro.id, ro.shopId],
    ),
    query<{ id: string; description: string }>(
      `SELECT l.id, l.description
         FROM repair_order_lines l
         JOIN repair_orders r ON r.id = l.repair_order_id
        WHERE l.repair_order_id = $1 AND r.shop_id = $2 AND l.kind = 'part'
        ORDER BY l.position`,
      [ro.id, ro.shopId],
    ),
  ]);

  const outstanding = parts.filter((part) =>
    ["needed", "requested", "ordered"].includes(part.status),
  ).length;
  // A returned part is not outstanding, but it was never in hand either —
  // "all in hand" over a single returned part would say the job can go ahead
  // when the shop still has to decide whether to re-order.
  const returned = parts.filter((part) => part.status === "returned").length;
  const inHand = parts.length - outstanding - returned;
  const closed = ro.status === "closed" || ro.status === "cancelled";

  return (
    <Section
      id="parts"
      title="Parts"
      detail={
        parts.length === 0
          ? "Nothing needed yet."
          : outstanding > 0
            ? `${outstanding} of ${parts.length} still outstanding`
            : returned === 0
              ? `All ${parts.length} in hand`
              : inHand === 0
                ? `${returned} returned — nothing in hand`
                : `${inHand} in hand · ${returned} returned`
      }
    >
      {parts.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {parts.map((part) => (
            <li key={part.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold text-ink">
                  {part.quantity > 1 && <span className="t-data text-ink-3">{part.quantity} ×</span>}
                  {part.name}
                  <StatusBadge kind="part" value={part.status} />
                  {part.overdue && <Tag tone="red">Overdue</Tag>}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.8125rem] text-ink-3">
                  {part.part_number && <span className="t-data">{part.part_number}</span>}
                  {part.supplier && <span>{part.supplier}</span>}
                  <span className="t-data">
                    {formatCents(part.unit_price_cents)} each
                    {part.unit_cost_cents > 0 && ` · cost ${formatCents(part.unit_cost_cents)}`}
                  </span>
                  {part.line_description && <span>for “{part.line_description}”</span>}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.75rem] text-ink-3">
                  {part.expected_at && !part.received_at && (
                    <span className={part.overdue ? "text-red-deep" : ""}>
                      Expected {formatDateTime(part.expected_at, ro.timezone)}
                    </span>
                  )}
                  {part.ordered_at && <span>Ordered {formatDateTime(part.ordered_at, ro.timezone)}</span>}
                  {part.received_at && <span>Received {formatDateTime(part.received_at, ro.timezone)}</span>}
                  {part.installed_at && <span>Installed {formatDateTime(part.installed_at, ro.timezone)}</span>}
                </p>
                {part.notes && <p className="mt-1 text-[0.8125rem] text-ink-2">{part.notes}</p>}
              </div>

              {!closed && NEXT[part.status].length > 0 && (
                <form action={setPartStatus} className="flex flex-wrap items-center gap-2 sm:flex-none">
                  <input type="hidden" name="part_id" value={part.id} />
                  <input type="hidden" name="repair_order_id" value={ro.id} />
                  {NEXT[part.status].map((next, index) => (
                    <button
                      key={next}
                      type="submit"
                      name="status"
                      value={next}
                      className={`btn btn-sm ${index === 0 ? "btn-emerald" : "btn-ghost"}`}
                      aria-label={`Mark ${part.name} ${PART_STATUS_LABEL[next].toLowerCase()}`}
                    >
                      {MOVE_LABEL[next]}
                    </button>
                  ))}
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {!closed && (
        <div className={parts.length > 0 ? "mt-6 border-t border-line pt-5" : ""}>
          {parts.length === 0 && (
            <p className="mb-4 text-[0.875rem] text-ink-2">
              A part is the physical thing with a supplier and an ETA; the line is the money. Add
              the part here and the ticket follows it — ordering parks the job, the last arrival
              puts it back on the lift.
            </p>
          )}
          <AddPartForm
            key={parts.length}
            repairOrderId={ro.id}
            lines={lines.map((line) => ({ id: line.id, label: line.description }))}
            marginPct={partsMargin(ro)}
          />
        </div>
      )}
    </Section>
  );
}

/**
 * The parts margin isn't on the panel contract; the page that knows it
 * passes it through the context as an extra field when it has one. The
 * default matches the schema's default so the hint is never blank.
 */
function partsMargin(ro: RoContext & { partsMarginPct?: string }): string {
  return ro.partsMarginPct ? String(Number(ro.partsMarginPct)) : "35";
}
