import Link from "next/link";

import { PageHead } from "@/components/app/shell";
import { Avatar, StatusBadge, Tag } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatCents } from "@/lib/money";
import {
  isRoStatus,
  PRIORITIES,
  RO_PIPELINE,
  RO_STATUS_LABEL,
  type Priority,
  type RoStatus,
} from "@/lib/statuses";

export const metadata = { title: "Repair orders" };

/**
 * The board.
 *
 * Columns in the order work actually moves through a shop — the pipeline,
 * minus closed, which has its own list underneath. "Needs approval" sits
 * third because it's the column that costs money while nobody looks at it:
 * a ticket parked there is a customer waiting on a phone call.
 *
 * Filters are query parameters, so a technician can bookmark "mine" on their
 * phone and the owner can send someone a link to Elena's column.
 */
const COLUMNS: RoStatus[] = RO_PIPELINE.filter((status) => status !== "closed");

interface Card {
  id: string;
  number: number;
  status: RoStatus;
  priority: Priority;
  total_cents: number;
  complaint: string | null;
  customer_name: string | null;
  vehicle: string | null;
  age_hours: number;
  approved_at: string | null;
  over_cap: boolean;
  technician_id: string | null;
  technician_name: string | null;
  parts_outstanding: number;
  has_pending_lines: boolean;
}

interface Technician {
  id: string;
  full_name: string;
}

function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

export default async function BoardPage(props: PageProps<"/app/repair-orders">) {
  const user = await requireUser();
  const params = await props.searchParams;

  const mine = params.mine === "1";
  const technicianParam = typeof params.technician === "string" ? params.technician : "";
  const priorityParam = typeof params.priority === "string" ? params.priority : "";

  // "mine" wins over a technician id; a uuid that isn't one is ignored rather
  // than sent to Postgres to throw on the cast.
  const technicianFilter = mine
    ? user.staffId
    : /^[0-9a-f-]{36}$/i.test(technicianParam)
      ? technicianParam
      : null;
  const priorityFilter = isPriority(priorityParam) ? priorityParam : null;

  // One column on its own, for the links from the dashboard and Ask ZOL
  // ("what's waiting on parts?"). Closed has its own list, so it isn't one.
  const statusParam = typeof params.status === "string" ? params.status : "";
  const statusFilter =
    isRoStatus(statusParam) && COLUMNS.includes(statusParam) ? statusParam : null;
  const columns = statusFilter ? [statusFilter] : COLUMNS;

  const [rows, recent, technicians] = await Promise.all([
    query<Card>(
      `SELECT ro.id, ro.number, ro.status, ro.priority, ro.total_cents, ro.complaint,
              c.full_name AS customer_name,
              nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
              extract(epoch FROM now() - ro.created_at) / 3600 AS age_hours,
              ro.approved_at::text,
              ro.total_cents > s.auto_quote_cap_cents AS over_cap,
              t.id AS technician_id, t.full_name AS technician_name,
              (SELECT count(*) FROM parts p
                WHERE p.repair_order_id = ro.id
                  AND p.status IN ('needed', 'requested', 'ordered'))::int AS parts_outstanding,
              EXISTS (SELECT 1 FROM repair_order_lines l
                       WHERE l.repair_order_id = ro.id AND l.approval = 'pending') AS has_pending_lines
         FROM repair_orders ro
         JOIN customers c ON c.id = ro.customer_id
         JOIN shops s ON s.id = ro.shop_id
         LEFT JOIN vehicles v ON v.id = ro.vehicle_id
         LEFT JOIN staff t ON t.id = ro.technician_id
        WHERE ro.shop_id = $1
          AND ro.status NOT IN ('closed', 'cancelled')
          AND ($2::uuid IS NULL OR ro.technician_id = $2)
          AND ($3::text IS NULL
               OR CASE WHEN $3 = 'high' THEN ro.priority IN ('high', 'urgent')
                       ELSE ro.priority = $3 END)
        ORDER BY CASE ro.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                 ro.promised_at NULLS LAST, ro.created_at`,
      [user.shopId, technicianFilter, priorityFilter],
    ),
    query<Card>(
      `SELECT ro.id, ro.number, ro.status, ro.priority, ro.total_cents, ro.complaint,
              c.full_name AS customer_name,
              nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
              0 AS age_hours, ro.approved_at::text, false AS over_cap,
              t.id AS technician_id, t.full_name AS technician_name,
              0 AS parts_outstanding, false AS has_pending_lines
         FROM repair_orders ro
         JOIN customers c ON c.id = ro.customer_id
         LEFT JOIN vehicles v ON v.id = ro.vehicle_id
         LEFT JOIN staff t ON t.id = ro.technician_id
        WHERE ro.shop_id = $1 AND ro.status IN ('closed', 'cancelled')
        ORDER BY coalesce(ro.closed_at, ro.updated_at) DESC
        LIMIT 10`,
      [user.shopId],
    ),
    query<Technician>(
      `SELECT id, full_name FROM staff
        WHERE shop_id = $1 AND role = 'tech' AND disabled_at IS NULL
        ORDER BY full_name`,
      [user.shopId],
    ),
  ]);

  const filtered = Boolean(technicianFilter || priorityFilter || statusFilter);

  return (
    <>
      <PageHead eyebrow={user.shopName} title="Repair orders">
        <Link href="/app/customers" className="btn btn-emerald btn-sm">
          Open a ticket
        </Link>
      </PageHead>

      <nav aria-label="Filter the board" className="mb-5 flex flex-wrap items-center gap-1.5">
        <FilterChip href="/app/repair-orders" active={!filtered}>
          Everything
        </FilterChip>
        <FilterChip href="/app/repair-orders?mine=1" active={mine}>
          Mine
        </FilterChip>
        {technicians.map((tech) => (
          <FilterChip
            key={tech.id}
            href={`/app/repair-orders?technician=${tech.id}`}
            active={!mine && technicianFilter === tech.id}
          >
            {tech.full_name}
          </FilterChip>
        ))}
        <FilterChip href="/app/repair-orders?priority=high" active={priorityFilter === "high"}>
          High priority
        </FilterChip>
        <FilterChip href="/app/repair-orders?priority=urgent" active={priorityFilter === "urgent"}>
          Urgent
        </FilterChip>
        {statusFilter && (
          <FilterChip href="/app/repair-orders" active>
            {RO_STATUS_LABEL[statusFilter]} only · show all
          </FilterChip>
        )}
      </nav>

      {rows.length === 0 && recent.length === 0 && !filtered ? (
        <div className="card p-8 text-center">
          <p className="text-[0.9375rem] font-semibold text-ink">No repair orders yet.</p>
          <p className="mx-auto mt-1 max-w-md text-[0.875rem] text-ink-2">
            Open one from a customer&rsquo;s record. Once ZOL is answering the phone, they
            arrive here on their own, priced, with the complaint in the caller&rsquo;s own words.
          </p>
        </div>
      ) : (
        /*
          Seven columns need about 90rem, so the board only becomes a board on
          a wide screen and scrolls sideways past that. On a phone it stacks:
          the same columns in the same order, read top to bottom. Sideways-
          scrolling a kanban one column at a time is how you miss the one that
          costs money.
        */
        <div className={statusFilter ? "pb-2" : "pb-2 lg:-mx-6 lg:overflow-x-auto lg:px-6"}>
          <div
            className={
              statusFilter
                ? "flex max-w-3xl flex-col gap-2"
                : "flex flex-col gap-6 lg:grid lg:min-w-[90rem] lg:grid-cols-7 lg:gap-3"
            }
          >
            {columns.map((status) => {
              const cards = rows.filter((row) => row.status === status);
              return (
                <section key={status} id={status} className="flex flex-col gap-2">
                  <h2 className="flex items-baseline justify-between gap-2 px-1">
                    <span className="t-eyebrow">{RO_STATUS_LABEL[status]}</span>
                    <span className="t-data text-[0.75rem] text-ink-3">{cards.length}</span>
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

      {recent.length > 0 && !filtered && (
        <section className="mt-8">
          <h2 className="t-eyebrow mb-2">Recently finished</h2>
          <ul className="card divide-y divide-line">
            {recent.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/app/repair-orders/${row.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2"
                >
                  <span className="t-data text-[0.875rem] text-ink-3">#{row.number}</span>
                  <span className="min-w-0 flex-1 text-[0.9375rem] font-semibold text-ink">
                    {row.customer_name ?? "Unnamed"}
                  </span>
                  <span className="text-[0.8125rem] text-ink-3">{row.vehicle}</span>
                  {row.technician_name && (
                    <span className="hidden text-[0.8125rem] text-ink-3 sm:inline">
                      {row.technician_name}
                    </span>
                  )}
                  <StatusBadge kind="ro" value={row.status} />
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

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-[0.8125rem] font-semibold transition-colors ${
        active
          ? "border-emerald-line bg-emerald-wash text-emerald-deep"
          : "border-line-2 bg-paper text-ink-2 hover:border-ink-3 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

function BoardCard({ card }: { card: Card }) {
  // Anything sitting more than a day in a column that isn't "waiting on parts"
  // is a ticket somebody has stopped thinking about.
  const stale = card.age_hours > 24 && card.status !== "awaiting_parts";
  const days = Math.floor(card.age_hours / 24);

  return (
    <Link
      href={`/app/repair-orders/${card.id}`}
      className="card block p-3 transition-colors hover:bg-paper-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="t-data text-[0.75rem] text-ink-3">#{card.number}</span>
        <span className="flex items-center gap-2">
          <span className="t-data text-[0.875rem] font-medium text-ink">
            {formatCents(card.total_cents)}
          </span>
          {card.technician_name ? (
            <span title={card.technician_name}>
              <Avatar name={card.technician_name} size="sm" tone="person" />
              <span className="sr-only">{card.technician_name}</span>
            </span>
          ) : (
            <span
              title="Unassigned"
              aria-label="Unassigned"
              className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-line-2 text-[0.6875rem] text-ink-3"
            >
              —
            </span>
          )}
        </span>
      </div>

      <p className="mt-1 truncate text-[0.9375rem] font-semibold text-ink">
        {card.customer_name ?? "Unnamed"}
      </p>
      {card.vehicle && <p className="truncate text-[0.8125rem] text-ink-2">{card.vehicle}</p>}
      {card.complaint && (
        <p className="mt-1.5 line-clamp-2 text-[0.8125rem] leading-snug text-ink-3">
          {card.complaint}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(card.priority === "high" || card.priority === "urgent") && (
          <StatusBadge kind="priority" value={card.priority} />
        )}
        {card.parts_outstanding > 0 && (
          <Tag tone="violet">
            {card.parts_outstanding} {card.parts_outstanding === 1 ? "part" : "parts"} out
          </Tag>
        )}
        {card.status === "awaiting_approval" && card.has_pending_lines && (
          <Tag tone="person">Needs a human</Tag>
        )}
        {card.over_cap && !card.approved_at && <Tag tone="person">Over cap</Tag>}
        {card.approved_at && <Tag tone="zol">Approved</Tag>}
        {stale && days > 0 && (
          <span className="t-data ml-auto text-[0.6875rem] text-ink-3" title={`${days} days on the board`}>
            {days}d
          </span>
        )}
      </div>
    </Link>
  );
}
