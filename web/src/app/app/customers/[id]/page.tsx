import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CustomerForm,
  VehicleForm,
  type CustomerRecord,
  type VehicleRecord,
} from "@/components/app/customer-forms";
import { PageHead } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { STATUS_LABEL, type Status } from "@/lib/repair-orders";

export async function generateMetadata(props: PageProps<"/app/customers/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const rows = await query<{ full_name: string | null }>(
    "SELECT full_name FROM customers WHERE id = $1 AND shop_id = $2",
    [id, user.shopId],
  );
  return { title: rows[0]?.full_name ?? "Customer" };
}

export default async function CustomerPage(
  props: PageProps<"/app/customers/[id]">,
) {
  const user = await requireUser();
  const { id } = await props.params;

  // shop_id in the WHERE, not just the id: the id is a uuid from the URL and
  // could have been pasted from another tenant's page.
  const rows = await query<CustomerRecord & { sms_opted_out: boolean }>(
    `SELECT id, full_name, phone, email, birthday::text, notes, sms_opted_out
       FROM customers WHERE id = $1 AND shop_id = $2`,
    [id, user.shopId],
  );

  const customer = rows[0];
  if (!customer) notFound();

  const [vehicles, repairOrders] = await Promise.all([
    query<VehicleRecord>(
      `SELECT id, year, make, model, trim, vin, plate, mileage
         FROM vehicles
        WHERE customer_id = $1 AND shop_id = $2
        ORDER BY created_at DESC`,
      [id, user.shopId],
    ),
    query<{
      id: string;
      number: number;
      status: Status;
      total_cents: number;
      complaint: string | null;
      created_at: string;
    }>(
      `SELECT id, number, status, total_cents, complaint, created_at::text
         FROM repair_orders
        WHERE customer_id = $1 AND shop_id = $2
        ORDER BY created_at DESC
        LIMIT 20`,
      [id, user.shopId],
    ),
  ]);

  return (
    <>
      <PageHead eyebrow="Customer" title={customer.full_name ?? "Unnamed"}>
        <Link href="/app/customers" className="btn btn-ghost btn-sm">
          All customers
        </Link>
        <Link
          href={`/app/repair-orders/new?customer=${customer.id}`}
          className="btn btn-emerald btn-sm"
        >
          Open a ticket
        </Link>
      </PageHead>

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
        {customer.sms_opted_out && (
          <span className="tag tag-person">Texts stopped</span>
        )}
      </div>

      <section className="card mb-6 p-5 sm:p-6">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="t-h3 text-[1.125rem]">
            Vehicles
            <span className="ml-2 text-[0.875rem] font-normal text-ink-3">
              {vehicles.length}
            </span>
          </h2>
        </div>

        {vehicles.length === 0 ? (
          <p className="text-[0.875rem] text-ink-2">
            Nothing on file yet. Add the car below — the year, make and model
            are what ZOL needs before it can price anything.
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id} className="py-3">
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="min-w-0 flex-1 text-[0.9375rem] font-semibold text-ink">
                      {[vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
                        .filter(Boolean)
                        .join(" ")}
                    </span>
                    {vehicle.plate && (
                      <span className="t-data text-[0.8125rem] text-ink-2">
                        {vehicle.plate}
                      </span>
                    )}
                    {vehicle.mileage !== null && (
                      <span className="t-data text-[0.8125rem] text-ink-3">
                        {vehicle.mileage.toLocaleString("en-US")} mi
                      </span>
                    )}
                    <span className="text-[0.8125rem] font-semibold text-emerald-deep group-open:hidden">
                      Edit
                    </span>
                  </summary>
                  <div className="mt-4">
                    <VehicleForm customerId={customer.id} vehicle={vehicle} />
                  </div>
                </details>
                {vehicle.vin && (
                  <p className="t-data mt-1 text-[0.75rem] text-ink-3">
                    VIN {vehicle.vin}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <details className="mt-5">
          <summary className="btn btn-ghost btn-sm cursor-pointer list-none">
            Add a vehicle
          </summary>
          <div className="mt-4">
            <VehicleForm customerId={customer.id} />
          </div>
        </details>
      </section>

      <section className="card mb-6 p-5 sm:p-6">
        <h2 className="t-h3 mb-4 text-[1.125rem]">
          Repair orders
          <span className="ml-2 text-[0.875rem] font-normal text-ink-3">
            {repairOrders.length}
          </span>
        </h2>

        {repairOrders.length === 0 ? (
          <p className="text-[0.875rem] text-ink-2">
            Nothing yet. Open one when they call, or let ZOL open it from the
            call itself once the phone line is live.
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {repairOrders.map((ro) => (
              <li key={ro.id}>
                <Link
                  href={`/app/repair-orders/${ro.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
                >
                  <span className="t-data text-[0.8125rem] text-ink-3">
                    #{ro.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink">
                    {ro.complaint ?? "No complaint recorded"}
                  </span>
                  <span className="tag tag-neutral">
                    {STATUS_LABEL[ro.status]}
                  </span>
                  <span className="t-data w-24 text-right text-[0.875rem] text-ink">
                    {formatCents(ro.total_cents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="t-h3 mb-4 text-[1.125rem]">Details</h2>
        <CustomerForm customer={customer} />
      </section>
    </>
  );
}
