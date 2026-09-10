import Link from "next/link";

import { PageHead } from "@/components/app/shell";
import { StatusBadge } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDate, formatMiles, vehicleLabel } from "@/lib/format";

export const metadata = { title: "Vehicles" };

interface Row {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  plate: string | null;
  vin: string | null;
  color: string | null;
  mileage: number | null;
  customer_id: string;
  owner: string | null;
  last_service: string | null;
  open_ro_id: string | null;
  open_ro_number: number | null;
  open_ro_status: string | null;
}

/**
 * Every car the shop has seen, searchable by the things written on the car.
 *
 * A tech in the bay knows the plate; the phone knows the caller; the parts
 * counter knows the VIN. One box takes all of them, plus the owner's name,
 * and the list answers the two questions that matter at a glance: when was
 * it last here, and is it here now.
 */
export default async function VehiclesPage(props: PageProps<"/app/vehicles">) {
  const user = await requireUser();
  const { q } = await props.searchParams;
  const search = typeof q === "string" ? q.trim() : "";
  const digits = search.replace(/\D/g, "");

  const rows = await query<Row>(
    `SELECT v.id, v.year, v.make, v.model, v.trim, v.plate, v.vin, v.color, v.mileage,
            c.id AS customer_id, c.full_name AS owner,
            (SELECT max(coalesce(ro.closed_at, ro.created_at))
               FROM repair_orders ro
              WHERE ro.vehicle_id = v.id AND ro.status = 'closed')::text AS last_service,
            o.id AS open_ro_id, o.number AS open_ro_number, o.status AS open_ro_status
       FROM vehicles v
       JOIN customers c ON c.id = v.customer_id
       LEFT JOIN LATERAL (
         SELECT ro.id, ro.number, ro.status
           FROM repair_orders ro
          WHERE ro.vehicle_id = v.id AND ro.status NOT IN ('closed', 'cancelled')
          ORDER BY ro.created_at DESC
          LIMIT 1
       ) o ON true
      WHERE v.shop_id = $1
        AND ($2 = '' OR
             v.plate ILIKE '%' || $2 || '%' OR
             v.vin ILIKE '%' || $2 || '%' OR
             v.make ILIKE '%' || $2 || '%' OR
             v.model ILIKE '%' || $2 || '%' OR
             concat_ws(' ', v.year::text, v.make, v.model) ILIKE '%' || $2 || '%' OR
             c.full_name ILIKE '%' || $2 || '%' OR
             ($3 <> '' AND c.phone LIKE '%' || $3 || '%'))
      ORDER BY o.id IS NULL, v.updated_at DESC
      LIMIT 100`,
    [user.shopId, search, digits],
  );

  return (
    <>
      <PageHead eyebrow={user.shopName} title="Vehicles">
        <Link href="/app/customers" className="btn btn-ghost btn-sm">
          Add one from a customer
        </Link>
      </PageHead>

      <form className="mb-5 flex gap-2" role="search">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Plate, VIN, make, model, or owner"
          aria-label="Search vehicles"
          className="input max-w-md"
        />
        <button type="submit" className="btn btn-ghost">
          Search
        </button>
        {search && (
          <Link href="/app/vehicles" className="btn btn-ghost">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-[0.9375rem] font-semibold text-ink">
            {search ? "Nothing matched that." : "No vehicles on file."}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[0.875rem] text-ink-2">
            {search
              ? "Try the plate, the last six of the VIN, or the owner's name."
              : "Vehicles are added from a customer's record, or by ZOL when a caller describes their car."}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table min-w-[44rem]">
            <thead>
              <tr>
                <th scope="col">Vehicle</th>
                <th scope="col">Plate</th>
                <th scope="col">Owner</th>
                <th scope="col" className="text-right">
                  Mileage
                </th>
                <th scope="col">Last service</th>
                <th scope="col">Open ticket</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link
                      href={`/app/vehicles/${row.id}`}
                      className="font-semibold text-ink underline-offset-2 hover:underline"
                    >
                      {vehicleLabel(row) ?? "Vehicle"}
                    </Link>
                    {row.color && (
                      <span className="ml-2 text-[0.8125rem] text-ink-3">{row.color}</span>
                    )}
                    {row.vin && (
                      <span className="t-data block text-[0.6875rem] text-ink-3">
                        VIN {row.vin}
                      </span>
                    )}
                  </td>
                  <td className="t-data text-ink-2">{row.plate ?? "—"}</td>
                  <td>
                    <Link
                      href={`/app/customers/${row.customer_id}`}
                      className="text-ink underline-offset-2 hover:underline"
                    >
                      {row.owner ?? "Unnamed"}
                    </Link>
                  </td>
                  <td className="t-data text-right text-ink-2">{formatMiles(row.mileage)}</td>
                  <td className="t-data text-ink-3">
                    {row.last_service ? formatDate(row.last_service, user.timezone) : "—"}
                  </td>
                  <td>
                    {row.open_ro_id ? (
                      <Link
                        href={`/app/repair-orders/${row.open_ro_id}`}
                        className="inline-flex items-center gap-2 underline-offset-2 hover:underline"
                      >
                        <span className="t-data text-ink-2">#{row.open_ro_number}</span>
                        <StatusBadge kind="ro" value={row.open_ro_status} />
                      </Link>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 100 && (
        <p className="mt-3 text-[0.8125rem] text-ink-3">
          Showing 100. Search to narrow it.
        </p>
      )}
    </>
  );
}
