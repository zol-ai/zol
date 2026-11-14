import Link from "next/link";

import { assignTicket, moveTicket } from "@/app/actions/technicians";
import { PageHead } from "@/components/app/shell";
import { Avatar, StatusBadge, Tag } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { RO_OPEN_STATUSES, RO_STATUS_LABEL, type RoStatus } from "@/lib/statuses";
import { ProfileForm } from "../team/profile-form";

export const metadata = { title: "Technicians" };

interface Tech {
  id: string;
  full_name: string;
  specialties: string[];
  phone: string | null;
}

interface Ticket {
  id: string;
  number: number;
  status: RoStatus;
  priority: string;
  complaint: string | null;
  promised_at: string | null;
  /** Promised time already passed, as the database saw it when the page rendered. */
  late: boolean;
  technician_id: string | null;
  customer_id: string;
  customer_name: string | null;
  vehicle_id: string | null;
  vehicle: string | null;
  parts_outstanding: boolean;
  pending_lines: string;
  approved_hours: string;
}

/**
 * The moves each column offers, in the words a tech uses. The status is
 * validated again on the server against the same table.
 */
const MOVES: Partial<Record<RoStatus, { to: RoStatus; label: string; primary?: boolean }[]>> = {
  open: [
    { to: "diagnosing", label: "Start diagnosing", primary: true },
    { to: "in_progress", label: "On the lift" },
  ],
  diagnosing: [{ to: "in_progress", label: "On the lift", primary: true }],
  awaiting_parts: [{ to: "in_progress", label: "Parts in — on the lift", primary: true }],
  in_progress: [{ to: "quality_check", label: "Send to QC", primary: true }],
  quality_check: [
    { to: "ready", label: "Passed — ready", primary: true },
    { to: "in_progress", label: "Back to the lift" },
  ],
};

/**
 * The board.
 *
 * One column per technician, and one for tickets nobody has yet. It is read
 * from a phone in the bay, so on a narrow screen the columns scroll sideways
 * one at a time and snap, rather than stacking into a scroll the length of
 * the shop. On a laptop they sit side by side.
 */
export default async function TechniciansPage() {
  const user = await requireUser();
  const owner = user.role === "owner";

  const [techs, tickets] = await Promise.all([
    query<Tech>(
      `SELECT id, full_name, specialties, phone
         FROM staff
        WHERE shop_id = $1 AND role = 'tech' AND disabled_at IS NULL
        ORDER BY full_name`,
      [user.shopId],
    ),
    query<Ticket>(
      `SELECT ro.id, ro.number, ro.status, ro.priority, ro.complaint,
              ro.promised_at::text,
              (ro.promised_at IS NOT NULL AND ro.promised_at < now()) AS late,
              ro.technician_id,
              ro.customer_id, c.full_name AS customer_name,
              ro.vehicle_id,
              nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
              EXISTS (SELECT 1 FROM parts p
                       WHERE p.repair_order_id = ro.id
                         AND p.status IN ('needed', 'requested', 'ordered')) AS parts_outstanding,
              (SELECT count(*) FROM repair_order_lines l
                WHERE l.repair_order_id = ro.id AND l.approval = 'pending')::text AS pending_lines,
              (SELECT coalesce(sum(l.quantity), 0) FROM repair_order_lines l
                WHERE l.repair_order_id = ro.id
                  AND l.kind = 'labor' AND l.approval = 'approved')::text AS approved_hours
         FROM repair_orders ro
         JOIN customers c ON c.id = ro.customer_id
         LEFT JOIN vehicles v ON v.id = ro.vehicle_id
        WHERE ro.shop_id = $1 AND ro.status = ANY($2::text[])
        ORDER BY
          CASE ro.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
          ro.promised_at NULLS LAST,
          ro.created_at`,
      [user.shopId, RO_OPEN_STATUSES],
    ),
  ]);

  const unassigned = tickets.filter((t) => !t.technician_id);
  const byTech = new Map<string, Ticket[]>();
  for (const ticket of tickets) {
    if (!ticket.technician_id) continue;
    const list = byTech.get(ticket.technician_id) ?? [];
    list.push(ticket);
    byTech.set(ticket.technician_id, list);
  }

  const hours = (list: Ticket[]) =>
    list.reduce((sum, ticket) => sum + Number(ticket.approved_hours), 0);

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Technicians"
        description="Who has what, and the next move on each ticket."
      >
        <Link href="/app/repair-orders" className="btn btn-ghost btn-sm">
          Board by status
        </Link>
      </PageHead>

      {techs.length === 0 && (
        <p className="card mb-6 p-5 text-[0.9375rem] text-ink-2">
          Nobody on the team is a technician yet. Invite one from{" "}
          <Link href="/app/team" className="font-semibold text-emerald-deep underline-offset-2 hover:underline">
            Team
          </Link>{" "}
          with the technician role and their column appears here.
        </p>
      )}

      <div className="-mx-3 flex snap-x snap-mandatory gap-4 overflow-x-auto px-3 pb-4 sm:-mx-5 sm:px-5 lg:mx-0 lg:grid lg:snap-none lg:overflow-visible lg:px-0 lg:[grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
        {techs.map((tech) => {
          const list = byTech.get(tech.id) ?? [];
          return (
            <section
              key={tech.id}
              aria-label={tech.full_name}
              className="w-[86vw] flex-none snap-center sm:w-[22rem] lg:w-auto"
            >
              <header className="card mb-3 p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={tech.full_name} tone="person" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-semibold text-ink">
                      {tech.full_name}
                    </p>
                    <p className="t-data text-[0.75rem] text-ink-3">
                      {list.length} {list.length === 1 ? "ticket" : "tickets"} ·{" "}
                      {hours(list).toFixed(1)} h approved
                    </p>
                  </div>
                </div>
                {tech.specialties.length > 0 ? (
                  <p className="mt-3 flex flex-wrap gap-1.5">
                    {tech.specialties.map((item) => (
                      <Tag key={item} tone="neutral">
                        {item}
                      </Tag>
                    ))}
                  </p>
                ) : (
                  <p className="mt-3 text-[0.8125rem] text-ink-3">No specialties recorded.</p>
                )}
                {owner && (
                  <details className="mt-3">
                    <summary className="cursor-pointer list-none text-[0.8125rem] font-semibold text-emerald-deep [&::-webkit-details-marker]:hidden">
                      Edit specialties and phone
                    </summary>
                    <div className="mt-3">
                      <ProfileForm staff={tech} returnTo="/app/technicians" />
                    </div>
                  </details>
                )}
              </header>

              {list.length === 0 ? (
                <p className="rounded-[var(--radius)] border border-dashed border-line-2 px-3 py-6 text-center text-[0.8125rem] text-ink-3">
                  Nothing assigned
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {list.map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} timezone={user.timezone} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        <section
          aria-label="Unassigned"
          className="w-[86vw] flex-none snap-center sm:w-[22rem] lg:w-auto"
        >
          <header className="card mb-3 p-4">
            <div className="flex items-center gap-3">
              <Avatar name="?" tone="neutral" />
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] font-semibold text-ink">Unassigned</p>
                <p className="t-data text-[0.75rem] text-ink-3">
                  {unassigned.length} {unassigned.length === 1 ? "ticket" : "tickets"} waiting
                  for a tech
                </p>
              </div>
            </div>
          </header>

          {unassigned.length === 0 ? (
            <p className="rounded-[var(--radius)] border border-dashed border-line-2 px-3 py-6 text-center text-[0.8125rem] text-ink-3">
              Everything open has a technician
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {unassigned.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  timezone={user.timezone}
                  assignTo={techs}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function TicketCard({
  ticket,
  timezone,
  assignTo,
}: {
  ticket: Ticket;
  timezone: string;
  /** Present on the unassigned column: the techs to pick from. */
  assignTo?: Tech[];
}) {
  const moves = MOVES[ticket.status] ?? [];
  const pendingLines = Number(ticket.pending_lines);
  const late = ticket.late;

  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/app/repair-orders/${ticket.id}`}
          className="t-data text-[0.9375rem] font-semibold text-ink underline-offset-4 hover:underline"
        >
          #{ticket.number}
        </Link>
        <StatusBadge kind="ro" value={ticket.status} />
      </div>

      <p className="mt-1.5 text-[0.9375rem] text-ink">{ticket.vehicle ?? "No vehicle on the ticket"}</p>
      <p className="text-[0.8125rem] text-ink-2">
        <Link
          href={`/app/customers/${ticket.customer_id}`}
          className="underline-offset-2 hover:underline"
        >
          {ticket.customer_name ?? "Unnamed"}
        </Link>
      </p>
      {ticket.complaint && (
        <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-3">
          {ticket.complaint}
        </p>
      )}

      {(ticket.parts_outstanding ||
        pendingLines > 0 ||
        ticket.priority === "high" ||
        ticket.priority === "urgent" ||
        ticket.promised_at) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(ticket.priority === "high" || ticket.priority === "urgent") && (
            <StatusBadge kind="priority" value={ticket.priority} />
          )}
          {ticket.parts_outstanding && <Tag tone="violet">Parts outstanding</Tag>}
          {pendingLines > 0 && (
            <Tag tone="person">
              {pendingLines} {pendingLines === 1 ? "line" : "lines"} awaiting approval
            </Tag>
          )}
          {ticket.promised_at && (
            <span className={`t-data text-[0.75rem] ${late ? "text-red-deep" : "text-ink-3"}`}>
              {late ? "promised " : "promised "}
              {formatDateTime(ticket.promised_at, timezone)}
              {late && " — late"}
            </span>
          )}
        </div>
      )}

      {Number(ticket.approved_hours) > 0 && (
        <p className="t-data mt-1.5 text-[0.75rem] text-ink-3">
          {Number(ticket.approved_hours).toFixed(1)} h approved labour
        </p>
      )}

      {assignTo ? (
        <form action={assignTicket} className="mt-3 flex gap-2 border-t border-line pt-3">
          <input type="hidden" name="repair_order_id" value={ticket.id} />
          <input type="hidden" name="return_to" value="/app/technicians" />
          <label htmlFor={`assign-${ticket.id}`} className="sr-only">
            Assign to
          </label>
          <select
            id={`assign-${ticket.id}`}
            name="technician_id"
            required
            defaultValue=""
            className="input min-w-0 flex-1 py-2 text-[0.875rem]"
          >
            <option value="" disabled>
              Pick a technician
            </option>
            {assignTo.map((tech) => (
              <option key={tech.id} value={tech.id}>
                {tech.full_name}
                {tech.specialties.length > 0 && ` — ${tech.specialties.slice(0, 2).join(", ")}`}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-emerald btn-sm">
            Assign
          </button>
        </form>
      ) : (
        moves.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            {moves.map((move) => (
              <form key={move.to} action={moveTicket}>
                <input type="hidden" name="repair_order_id" value={ticket.id} />
                <input type="hidden" name="to" value={move.to} />
                <input type="hidden" name="return_to" value="/app/technicians" />
                <button
                  type="submit"
                  className={`btn btn-sm ${move.primary ? "btn-emerald" : "btn-ghost"}`}
                  title={`${RO_STATUS_LABEL[ticket.status]} → ${RO_STATUS_LABEL[move.to]}`}
                >
                  {move.label}
                </button>
              </form>
            ))}
          </div>
        )
      )}
    </li>
  );
}
