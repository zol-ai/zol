import Link from "next/link";
import { notFound } from "next/navigation";

import { FollowUpList } from "@/components/app/crm/follow-up-list";
import { FollowUpNotices } from "@/components/app/crm/follow-up-notices";
import { listFollowUps } from "@/components/app/crm/follow-up-queries";
import { VehicleForm, type VehicleRecord } from "@/components/app/customer-forms";
import { PageHead } from "@/components/app/shell";
import {
  EmptyState,
  Facts,
  Notice,
  RatingDot,
  Section,
  StatusBadge,
  Tag,
} from "@/components/app/ui";
import { aiConfigured } from "@/lib/ai/client";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDate, formatDateTime, formatMiles, vehicleLabel } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(props: PageProps<"/app/vehicles/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Vehicle" };
  const rows = await query<{ year: number | null; make: string | null; model: string | null }>(
    "SELECT year, make, model FROM vehicles WHERE id = $1 AND shop_id = $2",
    [id, user.shopId],
  );
  return { title: rows[0] ? (vehicleLabel(rows[0]) ?? "Vehicle") : "Vehicle" };
}

interface VehicleRow extends VehicleRecord {
  customer_id: string;
  owner: string | null;
  owner_phone: string;
  created_at: string;
}

interface MileageRow {
  ro_id: string;
  number: number;
  mileage_in: number;
  created_at: string;
}

interface InspectionRow {
  id: string;
  repair_order_id: string;
  ro_number: number;
  overall: string;
  completed_at: string | null;
  created_at: string;
  technician: string | null;
  green: string;
  yellow: string;
  red: string;
  not_inspected: string;
}

interface DiagnosticRow {
  id: string;
  repair_order_id: string;
  ro_number: number;
  obd_codes: string[];
  symptoms: string | null;
  verification: string | null;
  verified_at: string | null;
  verified_by: string | null;
  ai_source: string;
  created_at: string;
}

interface TicketRow {
  id: string;
  number: number;
  status: string;
  complaint: string | null;
  total_cents: number;
  created_at: string;
  technician: string | null;
}

interface DeclinedRow {
  id: string;
  description: string;
  estimated_cents: number | null;
  declined_at: string;
  remind_after: string | null;
  reminded_at: string | null;
}

export default async function VehiclePage(props: PageProps<"/app/vehicles/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  // A malformed id would make Postgres throw on the uuid cast; it is simply
  // not found, which is what it is.
  if (!UUID.test(id)) notFound();
  const params = await props.searchParams;
  const returnTo = `/app/vehicles/${id}`;

  const rows = await query<VehicleRow>(
    `SELECT v.id, v.year, v.make, v.model, v.trim, v.engine, v.color, v.vin, v.plate,
            v.mileage, v.notes, v.created_at::text,
            c.id AS customer_id, c.full_name AS owner, c.phone AS owner_phone
       FROM vehicles v
       JOIN customers c ON c.id = v.customer_id
      WHERE v.id = $1 AND v.shop_id = $2`,
    [id, user.shopId],
  );
  const vehicle = rows[0];
  if (!vehicle) notFound();

  const [mileage, inspections, diagnostics, tickets, declined, followUps] = await Promise.all([
    query<MileageRow>(
      `SELECT ro.id AS ro_id, ro.number, ro.mileage_in, ro.created_at::text
         FROM repair_orders ro
        WHERE ro.vehicle_id = $1 AND ro.shop_id = $2 AND ro.mileage_in IS NOT NULL
        ORDER BY ro.created_at DESC
        LIMIT 24`,
      [id, user.shopId],
    ),
    query<InspectionRow>(
      `SELECT i.id, i.repair_order_id, ro.number AS ro_number, i.overall,
              i.completed_at::text, i.created_at::text, t.full_name AS technician,
              (SELECT count(*) FROM inspection_items x WHERE x.inspection_id = i.id AND x.rating = 'green')::text AS green,
              (SELECT count(*) FROM inspection_items x WHERE x.inspection_id = i.id AND x.rating = 'yellow')::text AS yellow,
              (SELECT count(*) FROM inspection_items x WHERE x.inspection_id = i.id AND x.rating = 'red')::text AS red,
              (SELECT count(*) FROM inspection_items x WHERE x.inspection_id = i.id AND x.rating = 'not_inspected')::text AS not_inspected
         FROM inspections i
         JOIN repair_orders ro ON ro.id = i.repair_order_id
         LEFT JOIN staff t ON t.id = i.technician_id
        WHERE i.vehicle_id = $1 AND i.shop_id = $2
        ORDER BY i.created_at DESC
        LIMIT 10`,
      [id, user.shopId],
    ),
    query<DiagnosticRow>(
      `SELECT d.id, d.repair_order_id, ro.number AS ro_number, d.obd_codes, d.symptoms,
              d.verification, d.verified_at::text, v.full_name AS verified_by,
              d.ai_source, d.created_at::text
         FROM diagnostics d
         JOIN repair_orders ro ON ro.id = d.repair_order_id
         LEFT JOIN staff v ON v.id = d.verified_by
        WHERE d.vehicle_id = $1 AND d.shop_id = $2
        ORDER BY d.created_at DESC
        LIMIT 10`,
      [id, user.shopId],
    ),
    query<TicketRow>(
      `SELECT ro.id, ro.number, ro.status, ro.complaint, ro.total_cents,
              ro.created_at::text, t.full_name AS technician
         FROM repair_orders ro
         LEFT JOIN staff t ON t.id = ro.technician_id
        WHERE ro.vehicle_id = $1 AND ro.shop_id = $2
        ORDER BY ro.created_at DESC
        LIMIT 30`,
      [id, user.shopId],
    ),
    query<DeclinedRow>(
      `SELECT id, description, estimated_cents, declined_at::text,
              remind_after::text, reminded_at::text
         FROM declined_work
        WHERE vehicle_id = $1 AND shop_id = $2 AND resolved_at IS NULL
        ORDER BY declined_at DESC`,
      [id, user.shopId],
    ),
    listFollowUps(user.shopId, { vehicleId: id, statuses: ["pending"], order: "scheduled" }),
  ]);

  const label = vehicleLabel(vehicle) ?? "Vehicle";
  const openTicket = tickets.find((t) => t.status !== "closed" && t.status !== "cancelled");

  return (
    <>
      <PageHead
        eyebrow={
          <>
            Vehicle ·{" "}
            <Link href={`/app/customers/${vehicle.customer_id}`} className="hover:underline">
              {vehicle.owner ?? "Unnamed"}
            </Link>
          </>
        }
        title={label}
      >
        <Link href="/app/vehicles" className="btn btn-ghost btn-sm">
          All vehicles
        </Link>
        <Link href={`/app/schedule/new?customer=${vehicle.customer_id}`} className="btn btn-ghost btn-sm">
          Book
        </Link>
        {openTicket ? (
          <Link href={`/app/repair-orders/${openTicket.id}`} className="btn btn-emerald btn-sm">
            Open ticket #{openTicket.number}
          </Link>
        ) : (
          <Link
            href={`/app/repair-orders/new?customer=${vehicle.customer_id}&vehicle=${vehicle.id}`}
            className="btn btn-emerald btn-sm"
          >
            Open a ticket
          </Link>
        )}
      </PageHead>

      {params.saved === "1" && (
        <Notice tone="zol" className="mb-6">
          Saved.
        </Notice>
      )}
      <FollowUpNotices params={params} />

      <div className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
        {vehicle.plate && (
          <span className="t-data text-[1.0625rem] font-medium text-ink">{vehicle.plate}</span>
        )}
        <span className="t-data text-[0.9375rem] text-ink-2">{formatMiles(vehicle.mileage)}</span>
        {vehicle.color && <span className="text-[0.9375rem] text-ink-2">{vehicle.color}</span>}
        {vehicle.engine && <span className="text-[0.9375rem] text-ink-2">{vehicle.engine}</span>}
        <span className="flex items-center gap-3 text-[0.875rem]">
          <Link
            href={`/app/customers/${vehicle.customer_id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {vehicle.owner ?? "Unnamed"}
          </Link>
          <a href={`tel:${vehicle.owner_phone}`} className="t-data text-ink-2">
            {formatPhone(vehicle.owner_phone)}
          </a>
        </span>
        {openTicket && (
          <span className="ml-auto">
            <StatusBadge kind="ro" value={openTicket.status} />
          </span>
        )}
        {/* The shop's own note about the car — the thing a tech wants before
            touching it, so it sits with the plate rather than under a form. */}
        {vehicle.notes && (
          <p className="w-full border-t border-line pt-2 text-[0.875rem] text-ink-2">
            {vehicle.notes}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <Section title="Tickets" flush>
            {tickets.length === 0 ? (
              <EmptyState title="Not been in yet" />
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
                      {ro.technician && (
                        <span className="hidden text-[0.8125rem] text-ink-3 md:inline">
                          {ro.technician}
                        </span>
                      )}
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

          <Section
            title="Inspections"
            detail="Every digital inspection this car has had. Counts are items rated good, watch, urgent."
            flush
          >
            {inspections.length === 0 ? (
              <EmptyState
                title="No inspections yet"
                detail="Techs start one from the ticket; the customer sees it on their portal page."
              />
            ) : (
              <ul className="divide-y divide-line">
                {inspections.map((insp) => (
                  <li key={insp.id}>
                    <Link
                      href={`/app/repair-orders/${insp.repair_order_id}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5"
                    >
                      <StatusBadge kind="rating" value={insp.overall} />
                      <span className="min-w-0 flex-1 text-[0.875rem] text-ink-2">
                        {insp.completed_at
                          ? `Completed ${formatDateTime(insp.completed_at, user.timezone)}`
                          : `Started ${formatDateTime(insp.created_at, user.timezone)}`}
                        {insp.technician && ` · ${insp.technician}`}
                        {" · "}
                        <span className="t-data">#{insp.ro_number}</span>
                      </span>
                      <span className="t-data flex items-center gap-3 text-[0.8125rem] text-ink-2">
                        <span className="inline-flex items-center gap-1.5">
                          <RatingDot rating="green" />
                          {insp.green}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <RatingDot rating="yellow" />
                          {insp.yellow}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <RatingDot rating="red" />
                          {insp.red}
                        </span>
                        {Number(insp.not_inspected) > 0 && (
                          <span className="text-ink-3">{insp.not_inspected} unchecked</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Diagnostics"
            detail="Codes and symptoms from each visit, and whether a technician confirmed the cause."
            flush
          >
            {diagnostics.length === 0 ? (
              <EmptyState title="No diagnostics recorded" />
            ) : (
              <ul className="divide-y divide-line">
                {diagnostics.map((diag) => (
                  <li key={diag.id}>
                    <Link
                      href={`/app/repair-orders/${diag.repair_order_id}`}
                      className="block px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {diag.obd_codes.length > 0 ? (
                          diag.obd_codes.map((code) => (
                            <span key={code} className="t-data rounded bg-paper-3 px-1.5 py-0.5 text-[0.8125rem] text-ink">
                              {code}
                            </span>
                          ))
                        ) : (
                          <span className="text-[0.8125rem] text-ink-3">No codes</span>
                        )}
                        <span className="ml-auto flex items-center gap-1.5">
                          {diag.verified_at ? (
                            <Tag tone="person">
                              Verified{diag.verified_by ? ` by ${diag.verified_by}` : ""}
                            </Tag>
                          ) : (
                            <Tag tone="neutral">Not yet verified</Tag>
                          )}
                          <Tag tone={diag.ai_source === "openai" ? "zol" : "neutral"}>
                            {diag.ai_source === "openai" ? "AI ranked" : "Rule-based"}
                          </Tag>
                        </span>
                      </div>
                      {diag.symptoms && (
                        <p className="mt-1.5 line-clamp-2 text-[0.875rem] text-ink-2">
                          {diag.symptoms}
                        </p>
                      )}
                      {diag.verification && (
                        <p className="mt-1 text-[0.875rem] text-ink">
                          <span className="text-ink-3">Tech:</span> {diag.verification}
                        </p>
                      )}
                      <p className="t-data mt-1 text-[0.75rem] text-ink-3">
                        #{diag.ro_number} · {formatDate(diag.created_at, user.timezone)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          <Section
            title="Mileage"
            detail="From each ticket's check-in reading. The header number is the newest."
          >
            {mileage.length === 0 ? (
              <p className="text-[0.875rem] text-ink-2">No readings recorded on a ticket yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {mileage.map((reading, index) => {
                  const previous = mileage[index + 1];
                  const delta = previous ? reading.mileage_in - previous.mileage_in : null;
                  return (
                    <li key={reading.ro_id} className="flex items-baseline gap-3 text-[0.875rem]">
                      <span className="t-data w-20 flex-none text-ink-3">
                        {formatDate(reading.created_at, user.timezone)}
                      </span>
                      <span className="t-data flex-1 text-ink">
                        {formatMiles(reading.mileage_in)}
                      </span>
                      {delta != null && delta > 0 && (
                        <span className="t-data text-[0.75rem] text-ink-3">
                          +{delta.toLocaleString("en-US")}
                        </span>
                      )}
                      <Link
                        href={`/app/repair-orders/${reading.ro_id}`}
                        className="t-data text-[0.75rem] text-ink-3 underline-offset-2 hover:underline"
                      >
                        #{reading.number}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>

          <Section title="Declined work" flush>
            {declined.length === 0 ? (
              <EmptyState title="Nothing declined on this car" />
            ) : (
              <ul className="divide-y divide-line">
                {declined.map((item) => (
                  <li key={item.id} className="px-4 py-3 sm:px-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[0.9375rem] font-semibold text-ink">{item.description}</p>
                      <span className="t-data text-[0.9375rem] text-ink">
                        {item.estimated_cents == null ? "—" : formatCents(item.estimated_cents)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[0.8125rem] text-ink-3">
                      declined {formatDate(item.declined_at, user.timezone)}
                      {item.reminded_at
                        ? ` · raised ${formatDate(item.reminded_at, user.timezone)}`
                        : item.remind_after
                          ? ` · bring up ${formatDate(item.remind_after, user.timezone)}`
                          : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <FollowUpList
            title="Scheduled follow-ups"
            empty="Nothing queued about this car."
            items={followUps}
            timezone={user.timezone}
            returnTo={returnTo}
            aiConfigured={aiConfigured()}
          />

          <Section title="On file">
            <Facts
              items={[
                { label: "VIN", value: <span className="t-data">{vehicle.vin ?? "—"}</span> },
                { label: "Plate", value: <span className="t-data">{vehicle.plate ?? "—"}</span> },
                { label: "Engine", value: vehicle.engine ?? "—" },
                { label: "Colour", value: vehicle.color ?? "—" },
                { label: "Added", value: formatDate(vehicle.created_at, user.timezone) },
              ]}
            />
          </Section>
        </div>
      </div>

      <div className="mt-6">
        <Section title="Specs" detail="Everything ZOL and the parts counter need to identify the car.">
          <VehicleForm customerId={vehicle.customer_id} vehicle={vehicle} />
        </Section>
      </div>
    </>
  );
}
