import Link from "next/link";

import { PageHead } from "@/components/app/shell";
import { Tag } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Customers" };

interface Row {
  id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  sms_opted_out: boolean;
  vehicles: string;
  vehicle_summary: string | null;
  last_visit: string | null;
  open_tickets: string;
}

export default async function CustomersPage(props: PageProps<"/app/customers">) {
  const user = await requireUser();
  const { q } = await props.searchParams;
  const search = typeof q === "string" ? q.trim() : "";

  /*
    One box, everything in it. The person at the counter has a name, or a
    phone, or a plate, or "the white Tacoma" — and no patience for choosing
    which field to search first. Digits are compared against the stored E.164
    with the formatting removed, so typing 555-0148 finds +14155550148.
  */
  const digits = search.replace(/\D/g, "");

  const rows = await query<Row>(
    `SELECT c.id, c.full_name, c.phone, c.email, c.sms_opted_out,
            (SELECT count(*) FROM vehicles v WHERE v.customer_id = c.id)::text AS vehicles,
            (SELECT concat_ws(' ', v2.year::text, v2.make, v2.model)
               FROM vehicles v2
              WHERE v2.customer_id = c.id
              ORDER BY v2.updated_at DESC LIMIT 1) AS vehicle_summary,
            (SELECT max(coalesce(ro.closed_at, ro.created_at))
               FROM repair_orders ro
              WHERE ro.customer_id = c.id)::text AS last_visit,
            (SELECT count(*) FROM repair_orders ro
              WHERE ro.customer_id = c.id
                AND ro.status NOT IN ('closed', 'cancelled'))::text AS open_tickets
       FROM customers c
      WHERE c.shop_id = $1
        AND ($2 = '' OR
             c.full_name ILIKE '%' || $2 || '%' OR
             c.email ILIKE '%' || $2 || '%' OR
             ($3 <> '' AND c.phone LIKE '%' || $3 || '%') OR
             EXISTS (SELECT 1 FROM vehicles vs
                      WHERE vs.customer_id = c.id
                        AND (vs.make ILIKE '%' || $2 || '%' OR
                             vs.model ILIKE '%' || $2 || '%' OR
                             vs.plate ILIKE '%' || $2 || '%' OR
                             vs.vin ILIKE '%' || $2 || '%')))
      ORDER BY coalesce(
                 (SELECT max(coalesce(ro.closed_at, ro.created_at))
                    FROM repair_orders ro WHERE ro.customer_id = c.id),
                 c.first_seen_at) DESC
      LIMIT 100`,
    [user.shopId, search, digits],
  );

  return (
    <>
      <PageHead eyebrow={user.shopName} title="Customers">
        <Link href="/app/customers/new" className="btn btn-emerald btn-sm">
          New customer
        </Link>
      </PageHead>

      {/* A plain GET form: the search lands in the URL, so it survives a
          reload and can be sent to somebody else. */}
      <form className="mb-5 flex gap-2" role="search">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Name, phone, plate, VIN, or make"
          aria-label="Search customers"
          className="input max-w-md"
        />
        <button type="submit" className="btn btn-ghost">
          Search
        </button>
        {search && (
          <Link href="/app/customers" className="btn btn-ghost">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-[0.9375rem] font-semibold text-ink">
            {search ? "Nothing matched that." : "No customers yet."}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[0.875rem] text-ink-2">
            {search
              ? "Try part of a name, the last four of a phone number, or a plate."
              : "Add the ones who call most, or let them arrive on their own once ZOL is answering the phone."}
          </p>
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map((row) => {
            const open = Number(row.open_tickets);
            return (
              <li key={row.id}>
                <Link
                  href={`/app/customers/${row.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-paper-2"
                >
                  <span className="min-w-0 flex-1 text-[0.9375rem] font-semibold text-ink">
                    {row.full_name ?? "Unnamed"}
                    {row.sms_opted_out && (
                      <Tag tone="person" className="ml-2 align-middle">
                        Texts stopped
                      </Tag>
                    )}
                  </span>
                  <span className="t-data text-[0.875rem] text-ink-2">
                    {formatPhone(row.phone)}
                  </span>
                  {open > 0 && (
                    <Tag tone="blue">
                      {open} open {open === 1 ? "ticket" : "tickets"}
                    </Tag>
                  )}
                  <span className="w-full text-[0.8125rem] text-ink-3 sm:w-auto sm:min-w-[13rem]">
                    {row.vehicle_summary ?? "No vehicle on file"}
                    {Number(row.vehicles) > 1 && ` +${Number(row.vehicles) - 1}`}
                  </span>
                  <span className="t-data w-full text-[0.75rem] text-ink-3 sm:w-28 sm:text-right">
                    {row.last_visit
                      ? `last ${formatDate(row.last_visit, user.timezone)}`
                      : "no visits yet"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length === 100 && (
        <p className="mt-3 text-[0.8125rem] text-ink-3">
          Showing the 100 most recent. Search to narrow it.
        </p>
      )}
    </>
  );
}
