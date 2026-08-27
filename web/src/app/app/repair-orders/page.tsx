import Link from "next/link";

import { STATUS_LABEL, type Status } from "@/lib/repair-orders";
import { PageHead } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatCents } from "@/lib/money";

export const metadata = { title: "Repair orders" };

/**
 * The board.
 *
 * Columns in the order work actually moves through a shop, which is not the
 * order the enum happens to be written in. "Needs approval" sits second
 * because it's the column that costs money while nobody looks at it — a
 * ticket parked there is a customer waiting on a phone call.
 */
const COLUMNS: Status[] = [
  "open",
  "awaiting_approval",
  "awaiting_parts",
  "in_progress",
  "ready",
];

interface Card {
  id: string;
  number: number;
  status: Status;
  total_cents: number;
  complaint: string | null;
  customer_name: string | null;
  vehicle: string | null;
  age_hours: number;
  approved_at: string | null;
  over_cap: boolean;
}

export default async function BoardPage() {
  const user = await requireUser();

  const rows = await query<Card>(
    `SELECT ro.id, ro.number, ro.status, ro.total_cents, ro.complaint,
            c.full_name AS customer_name,
            concat_ws(' ', v.year::text, v.make, v.model) AS vehicle,
            extract(epoch FROM now() - ro.created_at) / 3600 AS age_hours,
            ro.approved_at,
            ro.total_cents > s.auto_quote_cap_cents AS over_cap
       FROM repair_orders ro
       JOIN customers c ON c.id = ro.customer_id
       JOIN shops s ON s.id = ro.shop_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      WHERE ro.shop_id = $1 AND ro.status NOT IN ('closed', 'cancelled')
      ORDER BY ro.created_at DESC`,
    [user.shopId],
  );

  const recent = await query<Card>(
    `SELECT ro.id, ro.number, ro.status, ro.total_cents, ro.complaint,
            c.full_name AS customer_name,
            concat_ws(' ', v.year::text, v.make, v.model) AS vehicle,
            0 AS age_hours, ro.approved_at, false AS over_cap
       FROM repair_orders ro
       JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      WHERE ro.shop_id = $1 AND ro.status IN ('closed', 'cancelled')
      ORDER BY coalesce(ro.closed_at, ro.updated_at) DESC
      LIMIT 10`,
    [user.shopId],
  );

  return (
    <>
      <PageHead eyebrow={user.shopName} title="Repair orders">
        <Link href="/app/customers" className="btn btn-emerald btn-sm">
          Open a ticket
        </Link>
      </PageHead>

      {rows.length === 0 && recent.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-[0.9375rem] font-semibold text-ink">
            No repair orders yet.
          </p>
          <p className="mx-auto mt-1 max-w-md text-[0.875rem] text-ink-2">
            Open one from a customer&rsquo;s record. Once ZOL is answering the
            phone, they arrive here on their own, priced, with the complaint in
            the caller&rsquo;s own words.
          </p>
        </div>
      ) : (
        /*
          Five columns need about 64rem, so the board only becomes a board on
          a wide screen. On a phone it stacks: the same columns in the same
          order, read top to bottom. Sideways-scrolling a kanban one column at
          a time is how you miss the one that costs money.
        */
        <div className="pb-2 lg:-mx-8 lg:overflow-x-auto lg:px-8">
          <div className="flex flex-col gap-6 lg:grid lg:min-w-[64rem] lg:grid-cols-5 lg:gap-3">
            {COLUMNS.map((status) => {
              const cards = rows.filter((row) => row.status === status);
              return (
                <section key={status} className="flex flex-col gap-2">
                  <h2 className="flex items-baseline justify-between gap-2 px-1">
                    <span className="t-eyebrow">{STATUS_LABEL[status]}</span>
                    <span className="t-data text-[0.75rem] text-ink-3">
                      {cards.length}
                    </span>
                  </h2>

                  {cards.length === 0 ? (
                    <p className="rounded-[var(--radius)] border border-dashed border-line-2 px-3 py-4 text-center text-[0.8125rem] text-ink-3">
                      Empty
                    </p>
                  ) : (
                    cards.map((card) => <BoardCard key={card.id} card={card} />)
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="t-eyebrow mb-2">Recently finished</h2>
          <ul className="card divide-y divide-line">
            {recent.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/app/repair-orders/${row.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2"
                >
                  <span className="t-data text-[0.875rem] text-ink-3">
                    #{row.number}
                  </span>
                  <span className="min-w-0 flex-1 text-[0.9375rem] font-semibold text-ink">
                    {row.customer_name ?? "Unnamed"}
                  </span>
                  <span className="text-[0.8125rem] text-ink-3">
                    {row.vehicle}
                  </span>
                  <span className="tag tag-neutral">
                    {STATUS_LABEL[row.status]}
                  </span>
                  <span className="t-data w-24 text-right text-[0.875rem] text-ink">
                    {formatCents(row.total_cents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function BoardCard({ card }: { card: Card }) {
  // Anything sitting more than a day in a column that isn't "waiting on parts"
  // is a ticket somebody has stopped thinking about.
  const stale = card.age_hours > 24;

  return (
    <Link
      href={`/app/repair-orders/${card.id}`}
      className="card block p-3 transition-colors hover:bg-paper-2"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-data text-[0.75rem] text-ink-3">#{card.number}</span>
        <span className="t-data text-[0.875rem] font-medium text-ink">
          {formatCents(card.total_cents)}
        </span>
      </div>

      <p className="mt-1 truncate text-[0.9375rem] font-semibold text-ink">
        {card.customer_name ?? "Unnamed"}
      </p>
      {card.vehicle && (
        <p className="truncate text-[0.8125rem] text-ink-2">{card.vehicle}</p>
      )}
      {card.complaint && (
        <p className="mt-1.5 line-clamp-2 text-[0.8125rem] leading-snug text-ink-3">
          {card.complaint}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {card.status === "awaiting_approval" && !card.approved_at && (
          <span className="tag tag-person">Needs a human</span>
        )}
        {card.over_cap && !card.approved_at && (
          <span className="tag tag-person">Over cap</span>
        )}
        {card.approved_at && <span className="tag tag-zol">Approved</span>}
        {stale && card.status !== "awaiting_parts" && (
          <span className="t-data text-[0.6875rem] text-ink-3">
            {Math.floor(card.age_hours / 24)}d
          </span>
        )}
      </div>
    </Link>
  );
}
