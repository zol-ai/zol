import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BookingForm } from "@/components/app/booking-form";
import { PageHead } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { zonedDate } from "@/lib/schedule";

export const metadata = { title: "Book a bay" };

export default async function BookPage(props: PageProps<"/app/schedule/new">) {
  const user = await requireUser();
  const { customer, date } = await props.searchParams;

  // An appointment is somebody's. Without a customer there's nothing to book.
  if (typeof customer !== "string" || !customer) redirect("/app/customers");

  const rows = await query<{ full_name: string | null; phone: string }>(
    "SELECT full_name, phone FROM customers WHERE id = $1 AND shop_id = $2",
    [customer, user.shopId],
  );
  if (rows.length === 0) notFound();

  const [vehicles, repairOrders, shops] = await Promise.all([
    query<{ id: string; year: number | null; make: string | null; model: string | null }>(
      `SELECT id, year, make, model FROM vehicles
        WHERE customer_id = $1 AND shop_id = $2
        ORDER BY created_at DESC`,
      [customer, user.shopId],
    ),
    query<{ id: string; number: number; complaint: string | null }>(
      `SELECT id, number, complaint FROM repair_orders
        WHERE customer_id = $1 AND shop_id = $2
          AND status NOT IN ('closed', 'cancelled')
        ORDER BY created_at DESC`,
      [customer, user.shopId],
    ),
    query<{ bay_count: number }>("SELECT bay_count FROM shops WHERE id = $1", [
      user.shopId,
    ]),
  ]);

  return (
    <>
      <PageHead eyebrow="Book a bay" title={rows[0].full_name ?? "Unnamed"}>
        <Link href={`/app/customers/${customer}`} className="btn btn-ghost btn-sm">
          Cancel
        </Link>
      </PageHead>

      <p className="t-data mb-5 text-[0.9375rem] text-ink-2">
        {formatPhone(rows[0].phone)}
      </p>

      <section className="card max-w-2xl p-5 sm:p-6">
        <BookingForm
          customerId={customer}
          bayCount={shops[0].bay_count}
          defaultDate={
            typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
              ? date
              : zonedDate(new Date(), user.timezone)
          }
          vehicles={vehicles.map((vehicle) => ({
            id: vehicle.id,
            label:
              [vehicle.year, vehicle.make, vehicle.model]
                .filter(Boolean)
                .join(" ") || "Vehicle",
          }))}
          repairOrders={repairOrders.map((ro) => ({
            id: ro.id,
            label: `#${ro.number} — ${ro.complaint ?? "no complaint recorded"}`,
          }))}
        />
      </section>
    </>
  );
}
