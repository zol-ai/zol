import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { NewRepairOrderForm } from "@/components/app/ro-forms";
import { PageHead } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { vehicleLabel } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "New repair order" };

export default async function NewRepairOrderPage(props: PageProps<"/app/repair-orders/new">) {
  const user = await requireUser();
  const { customer, vehicle } = await props.searchParams;

  // A ticket belongs to somebody. Without a customer there is nothing to open,
  // so send them to pick one rather than showing an empty form.
  if (typeof customer !== "string" || !customer) redirect("/app/customers");

  // From a vehicle's own page: that car is the obvious default. Checked
  // against the customer's vehicles below rather than trusted.
  const preferredVehicle = typeof vehicle === "string" ? vehicle : null;

  const rows = await query<{ id: string; full_name: string | null; phone: string }>(
    "SELECT id, full_name, phone FROM customers WHERE id = $1 AND shop_id = $2",
    [customer, user.shopId],
  );
  if (rows.length === 0) notFound();

  const [vehicles, technicians] = await Promise.all([
    query<{
      id: string;
      year: number | null;
      make: string | null;
      model: string | null;
      trim: string | null;
      plate: string | null;
    }>(
      `SELECT id, year, make, model, trim, plate FROM vehicles
        WHERE customer_id = $1 AND shop_id = $2
        ORDER BY created_at DESC`,
      [customer, user.shopId],
    ),
    query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM staff
        WHERE shop_id = $1 AND role = 'tech' AND disabled_at IS NULL
        ORDER BY full_name`,
      [user.shopId],
    ),
  ]);

  return (
    <>
      <PageHead eyebrow="New repair order" title={rows[0].full_name ?? "Unnamed"}>
        <Link href={`/app/customers/${customer}`} className="btn btn-ghost btn-sm">
          Cancel
        </Link>
      </PageHead>

      <p className="t-data mb-5 text-[0.9375rem] text-ink-2">{formatPhone(rows[0].phone)}</p>

      <section className="card max-w-2xl p-5 sm:p-6">
        <NewRepairOrderForm
          customerId={customer}
          vehicles={vehicles.map((vehicle) => ({
            id: vehicle.id,
            label: `${vehicleLabel(vehicle) ?? "Vehicle"}${vehicle.plate ? ` · ${vehicle.plate}` : ""}`,
          }))}
          technicians={technicians.map((tech) => ({ id: tech.id, name: tech.full_name }))}
          defaultVehicleId={
            vehicles.some((candidate) => candidate.id === preferredVehicle) ? preferredVehicle : null
          }
        />
      </section>
    </>
  );
}
