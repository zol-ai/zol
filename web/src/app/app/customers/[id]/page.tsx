import Link from "next/link";
import { notFound } from "next/navigation";
import { Car, CircleDollarSign, History, Wrench } from "lucide-react";

import { FollowUpList } from "@/components/app/crm/follow-up-list";
import { FollowUpNotices } from "@/components/app/crm/follow-up-notices";
import { listFollowUps } from "@/components/app/crm/follow-up-queries";
import {
  CustomerForm,
  VehicleForm,
  type CustomerRecord,
  type VehicleRecord,
} from "@/components/app/customer-forms";
import { PageHead } from "@/components/app/shell";
import {
  EmptyState,
  MetricCard,
  Notice,
  Section,
  StatusBadge,
  Tag,
} from "@/components/app/ui";
import { aiConfigured } from "@/lib/ai/client";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  formatDate,
  formatDateTime,
  formatMiles,
  formatRelative,
  formatWhen,
  vehicleLabel,
} from "@/lib/format";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(props: PageProps<"/app/customers/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Customer" };
  const rows = await query<{ full_name: string | null }>(
    "SELECT full_name FROM customers WHERE id = $1 AND shop_id = $2",
    [id, user.shopId],
  );
  return { title: rows[0]?.full_name ?? "Customer" };
}

const PREFERRED: Record<string, string> = {
  sms: "Prefers a text",
  email: "Prefers email",
  phone: "Prefers a call",
};

interface VehicleRow extends VehicleRecord {
  open_tickets: string;
  last_service: string | null;
}

interface AppointmentRow {
  id: string;
  starts_at: string;
  status: string;
  service_type: string | null;
  bay: number | null;
  booked_by_agent: boolean;
  vehicle: string | null;
  technician: string | null;
}

interface TicketRow {
  id: string;
  number: number;
  status: string;
  total_cents: number;
  complaint: string | null;
  created_at: string;
  vehicle: string | null;
}

interface CallRow {
  id: string;
  started_at: string;
  duration_seconds: number | null;
  status: string;
  outcome: string | null;
  summary: string | null;
  simulated: boolean;
  handled_by: string;
}

interface MessageRow {
  id: string;
  direction: string;
  channel: string;
  body: string;
  created_at: string;
  sent_by_agent: boolean;
}

interface DeclinedRow {
  id: string;
  description: string;
  estimated_cents: number | null;
  declined_at: string;
  remind_after: string | null;
  reminded_at: string | null;
  vehicle: string | null;
}

export default async function CustomerPage(props: PageProps<"/app/customers/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  // A malformed id would make Postgres throw on the uuid cast; it is simply
  // not found, which is what it is.
  if (!UUID.test(id)) notFound();
  const params = await props.searchParams;
  const returnTo = `/app/customers/${id}`;

  // shop_id in the WHERE, not just the id: the id is a uuid from the URL and
  // could have been pasted from another tenant's page.
  const rows = await query<
    CustomerRecord & { sms_opted_out: boolean; first_seen_at: string }
  >(
    `SELECT id, full_name, phone, email, birthday::text, notes, sms_opted_out,
            preferred_contact, address, first_seen_at::text
       FROM customers WHERE id = $1 AND shop_id = $2`,
    [id, user.shopId],
  );

  const customer = rows[0];
  if (!customer) notFound();

  const [stats, vehicles, appointments, tickets, followUps, calls, messages, declined] =
    await Promise.all([
      query<{
        vehicles: string;
        visits: string;
        lifetime_cents: string;
        last_visit: string | null;
      }>(
        `SELECT
           (SELECT count(*) FROM vehicles v WHERE v.customer_id = $1)::text AS vehicles,
           (SELECT count(*) FROM repair_orders ro WHERE ro.customer_id = $1)::text AS visits,
           (SELECT coalesce(sum(p.amount_cents), 0)
              FROM payments p
              JOIN invoices i ON i.id = p.invoice_id
             WHERE i.customer_id = $1 AND p.shop_id = $2
               AND p.status = 'succeeded')::text AS lifetime_cents,
           (SELECT max(coalesce(ro.closed_at, ro.created_at))
              FROM repair_orders ro WHERE ro.customer_id = $1)::text AS last_visit`,
        [id, user.shopId],
      ),
      query<VehicleRow>(
        `SELECT v.id, v.year, v.make, v.model, v.trim, v.engine, v.color,
                v.vin, v.plate, v.mileage, v.notes,
                (SELECT count(*) FROM repair_orders ro
                  WHERE ro.vehicle_id = v.id
                    AND ro.status NOT IN ('closed', 'cancelled'))::text AS open_tickets,
                (SELECT max(coalesce(ro.closed_at, ro.created_at))
                   FROM repair_orders ro WHERE ro.vehicle_id = v.id)::text AS last_service
           FROM vehicles v
          WHERE v.customer_id = $1 AND v.shop_id = $2
          ORDER BY v.created_at DESC`,
        [id, user.shopId],
      ),
      query<AppointmentRow>(
        `SELECT a.id, a.starts_at::text, a.status, a.service_type, a.bay, a.booked_by_agent,
                nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
                t.full_name AS technician
           FROM appointments a
           LEFT JOIN vehicles v ON v.id = a.vehicle_id
           LEFT JOIN staff t ON t.id = a.technician_id
          WHERE a.customer_id = $1 AND a.shop_id = $2
            AND a.ends_at >= now()
            AND a.status IN ('booked', 'confirmed', 'arrived')
          ORDER BY a.starts_at
          LIMIT 10`,
        [id, user.shopId],
      ),
      query<TicketRow>(
        `SELECT ro.id, ro.number, ro.status, ro.total_cents, ro.complaint,
                ro.created_at::text,
                nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle
           FROM repair_orders ro
           LEFT JOIN vehicles v ON v.id = ro.vehicle_id
          WHERE ro.customer_id = $1 AND ro.shop_id = $2
          ORDER BY ro.created_at DESC
          LIMIT 30`,
        [id, user.shopId],
      ),
      listFollowUps(user.shopId, { customerId: id, statuses: ["pending"], order: "scheduled" }),
      query<CallRow>(
        `SELECT id, started_at::text, duration_seconds, status, outcome, summary,
                simulated, handled_by
           FROM calls
          WHERE customer_id = $1 AND shop_id = $2
          ORDER BY started_at DESC
          LIMIT 10`,
        [id, user.shopId],
      ),
      query<MessageRow>(
        `SELECT id, direction, channel, body, created_at::text, sent_by_agent
           FROM messages
          WHERE customer_id = $1 AND shop_id = $2 AND channel <> 'note'
          ORDER BY created_at DESC
          LIMIT 10`,
        [id, user.shopId],
      ),
      query<DeclinedRow>(
        `SELECT d.id, d.description, d.estimated_cents, d.declined_at::text,
                d.remind_after::text, d.reminded_at::text,
                nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle
           FROM declined_work d
           LEFT JOIN vehicles v ON v.id = d.vehicle_id
          WHERE d.customer_id = $1 AND d.shop_id = $2 AND d.resolved_at IS NULL
          ORDER BY d.declined_at DESC`,
        [id, user.shopId],
      ),
    ]);

  const s = stats[0];
  const ai = aiConfigured();

  return (
    <>
      <PageHead eyebrow="Customer" title={customer.full_name ?? "Unnamed"}>
        <Link href="/app/customers" className="btn btn-ghost btn-sm">
          All customers
        </Link>
        <Link href={`/app/messages?customer=${customer.id}`} className="btn btn-ghost btn-sm">
          Message
        </Link>
        <Link href={`/app/schedule/new?customer=${customer.id}`} className="btn btn-ghost btn-sm">
          Book
        </Link>
        <Link
          href={`/app/repair-orders/new?customer=${customer.id}`}
          className="btn btn-emerald btn-sm"
        >
          Open a ticket
        </Link>
      </PageHead>

      {params.saved === "1" && (
        <Notice tone="zol" className="mb-6">
          Saved.
        </Notice>
      )}
      <FollowUpNotices params={params} />

      <div className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
        <a
          href={`tel:${customer.phone}`}
          className="t-data text-[1.0625rem] font-medium text-ink underline-offset-4 hover:underline"
        >
          {formatPhone(customer.phone)}
        </a>
        {customer.email && (
          <a
            href={`mailto:${customer.email}`}
            className="text-[0.9375rem] text-ink-2 underline-offset-4 hover:underline"
          >
            {customer.email}
          </a>
        )}
        {customer.address && (
          <span className="text-[0.875rem] text-ink-2">{customer.address}</span>
        )}
        <span className="flex flex-wrap items-center gap-2">
          <Tag tone="neutral">{PREFERRED[customer.preferred_contact] ?? "Prefers a text"}</Tag>
          {customer.sms_opted_out && <Tag tone="person">Texts stopped</Tag>}
        </span>
        <span className="t-data ml-auto text-[0.75rem] text-ink-3">
          customer since {formatDate(customer.first_seen_at, user.timezone)}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Vehicles" value={Number(s?.vehicles ?? 0)} icon={Car} />
        <MetricCard label="Visits" value={Number(s?.visits ?? 0)} icon={Wrench} />
        <MetricCard
          label="Lifetime value"
          value={formatCents(Number(s?.lifetime_cents ?? 0))}
          icon={CircleDollarSign}
          tone="zol"
          detail="paid invoices"
        />
        <MetricCard
          label="Last visit"
          value={s?.last_visit ? formatRelative(s.last_visit, user.timezone) : "—"}
          icon={History}
          detail={s?.last_visit ? formatDate(s.last_visit, user.timezone) : "never"}
        />
      </div>

      <div className="flex flex-col gap-6">
        <Section
          title={
            <>
              Vehicles
              <span className="ml-2 text-[0.875rem] font-normal normal-case tracking-normal text-ink-3">
                {vehicles.length}
              </span>
            </>
          }
          detail="Year, make and model are what ZOL needs before it can quote anything."
        >
          {vehicles.length === 0 ? (
            <p className="text-[0.875rem] text-ink-2">Nothing on file yet. Add the car below.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {vehicles.map((vehicle) => {
                const open = Number(vehicle.open_tickets);
                return (
                  <li key={vehicle.id}>
                    <Link
                      href={`/app/vehicles/${vehicle.id}`}
                      className="block rounded-[var(--radius)] border border-line p-4 transition-colors hover:bg-paper-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-[0.9375rem] font-semibold text-ink">
                          {vehicleLabel(vehicle) ?? "Vehicle"}
                        </p>
                        {open > 0 && (
                          <Tag tone="blue">
                            {open} open {open === 1 ? "ticket" : "tickets"}
                          </Tag>
                        )}
                      </div>
                      <p className="t-data mt-1 flex flex-wrap gap-x-3 text-[0.8125rem] text-ink-2">
                        {vehicle.plate && <span>{vehicle.plate}</span>}
                        <span className="text-ink-3">{formatMiles(vehicle.mileage)}</span>
                        {vehicle.color && <span className="text-ink-3">{vehicle.color}</span>}
                      </p>
                      <p className="mt-1.5 text-[0.75rem] text-ink-3">
                        {vehicle.last_service
                          ? `Last in ${formatDate(vehicle.last_service, user.timezone)}`
                          : "Not been in yet"}
                        {vehicle.vin && (
                          <span className="t-data ml-2">VIN …{vehicle.vin.slice(-6)}</span>
                        )}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <details className="mt-4">
            <summary className="btn btn-ghost btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              Add a vehicle
            </summary>
            <div className="mt-4">
              <VehicleForm customerId={customer.id} />
            </div>
          </details>
        </Section>

        {appointments.length > 0 && (
          <Section title="Coming up" flush>
            <ul className="divide-y divide-line">
              {appointments.map((appt) => (
                <li key={appt.id}>
                  <Link
                    href="/app/schedule"
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5"
                  >
                    <span className="text-[0.9375rem] font-semibold text-ink">
                      {formatWhen(appt.starts_at, user.timezone)}
                    </span>
                    <span className="min-w-0 flex-1 text-[0.875rem] text-ink-2">
                      {appt.service_type ?? "Appointment"}
                      {appt.vehicle && ` · ${appt.vehicle}`}
                      {appt.technician && ` · with ${appt.technician}`}
                      {appt.bay && ` · bay ${appt.bay}`}
                    </span>
                    {appt.booked_by_agent && <Tag tone="zol">ZOL booked</Tag>}
                    <StatusBadge kind="appointment" value={appt.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <FollowUpList
          title="Follow-ups"
          empty={
            <>
              Nothing queued for {customer.full_name?.split(" ")[0] ?? "them"}. Journey
              messages appear here as tickets move; retention ones come from the{" "}
              <Link href="/app/crm" className="underline underline-offset-2">
                CRM
              </Link>
              .
            </>
          }
          items={followUps}
          timezone={user.timezone}
          returnTo={returnTo}
          aiConfigured={ai}
          showCustomer={false}
        />

        <Section
          title={
            <>
              Service history
              <span className="ml-2 text-[0.875rem] font-normal normal-case tracking-normal text-ink-3">
                {s?.visits ?? 0}
              </span>
            </>
          }
          flush
        >
          {tickets.length === 0 ? (
            <EmptyState
              title="No tickets yet"
              detail="Open one when they call, or let ZOL open it from the call itself once the phone line is live."
            />
          ) : (
            <ul className="divide-y divide-line">
              {tickets.map((ro) => (
                <li key={ro.id}>
                  <Link
                    href={`/app/repair-orders/${ro.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5"
                  >
                    <span className="t-data text-[0.8125rem] text-ink-3">#{ro.number}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink">
                      {ro.complaint ?? "No complaint recorded"}
                    </span>
                    <span className="hidden text-[0.8125rem] text-ink-3 md:inline">
                      {ro.vehicle}
                    </span>
                    <span className="t-data text-[0.75rem] text-ink-3">
                      {formatDate(ro.created_at, user.timezone)}
                    </span>
                    <StatusBadge kind="ro" value={ro.status} />
                    <span className="t-data w-24 text-right text-[0.875rem] text-ink">
                      {formatCents(ro.total_cents)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Calls" flush>
            {calls.length === 0 ? (
              <EmptyState
                title="No calls on record"
                detail="Once ZOL is answering the line, every call lands here with its transcript."
              />
            ) : (
              <ul className="divide-y divide-line">
                {calls.map((call) => (
                  <li key={call.id}>
                    <Link
                      href={`/app/calls/${call.id}`}
                      className="block px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="t-data text-[0.8125rem] text-ink-2">
                          {formatDateTime(call.started_at, user.timezone)}
                        </span>
                        {call.duration_seconds != null && (
                          <span className="t-data text-[0.75rem] text-ink-3">
                            {Math.round(call.duration_seconds / 60)} min
                          </span>
                        )}
                        <span className="ml-auto flex gap-1.5">
                          <Tag tone={call.handled_by === "zol" ? "zol" : "person"}>
                            {call.handled_by === "zol" ? "ZOL" : "Person"}
                          </Tag>
                          {call.simulated && <Tag tone="neutral">Test call</Tag>}
                          <StatusBadge
                            kind="callOutcome"
                            value={call.outcome ?? call.status}
                          />
                        </span>
                      </div>
                      {call.summary && (
                        <p className="mt-1 line-clamp-2 text-[0.875rem] text-ink-2">
                          {call.summary}
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Recent messages"
            flush
            action={
              <Link
                href={`/app/messages?customer=${customer.id}`}
                className="text-[0.8125rem] font-semibold text-emerald-deep"
              >
                Open thread
              </Link>
            }
          >
            {messages.length === 0 ? (
              <EmptyState title="Nothing said yet" />
            ) : (
              <ul className="divide-y divide-line">
                {messages.map((message) => (
                  <li key={message.id} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2 text-[0.75rem]">
                      <Tag
                        tone={
                          message.direction === "inbound"
                            ? "blue"
                            : message.sent_by_agent
                              ? "zol"
                              : "person"
                        }
                      >
                        {message.direction === "inbound"
                          ? "From them"
                          : message.sent_by_agent
                            ? "ZOL"
                            : "Shop"}
                      </Tag>
                      <StatusBadge kind="channel" value={message.channel} />
                      <span className="t-data ml-auto text-ink-3">
                        {formatRelative(message.created_at, user.timezone)}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-3 text-[0.875rem] leading-relaxed text-ink-2">
                      {message.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <Section
          title="Declined work"
          detail="What they said no to, and when it comes back round."
          flush
          action={
            <Link href="/app/declined" className="text-[0.8125rem] font-semibold text-emerald-deep">
              Recall list
            </Link>
          }
        >
          {declined.length === 0 ? (
            <EmptyState title="Nothing declined" detail="Record it from a repair order when it happens." />
          ) : (
            <ul className="divide-y divide-line">
              {declined.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] font-semibold text-ink">
                      {item.description}
                    </span>
                    <span className="block text-[0.8125rem] text-ink-3">
                      {item.vehicle && `${item.vehicle} · `}
                      declined {formatDate(item.declined_at, user.timezone)}
                      {item.reminded_at
                        ? ` · raised ${formatDate(item.reminded_at, user.timezone)}`
                        : item.remind_after
                          ? ` · bring up ${formatDate(item.remind_after, user.timezone)}`
                          : ""}
                    </span>
                  </span>
                  <span className="t-data text-[0.9375rem] text-ink">
                    {item.estimated_cents == null ? "—" : formatCents(item.estimated_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Details">
          <CustomerForm customer={customer} />
        </Section>
      </div>
    </>
  );
}
