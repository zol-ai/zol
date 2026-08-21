import Link from "next/link";

import { updateDeclined } from "@/app/actions/declined";
import { PageHead } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Declined work" };

interface Item {
  id: string;
  description: string;
  estimated_cents: number | null;
  declined_at: string;
  remind_after: string | null;
  reminded_at: string | null;
  customer_id: string;
  customer_name: string | null;
  phone: string;
  sms_opted_out: boolean;
  vehicle: string | null;
  due: boolean;
}

export default async function DeclinedPage() {
  const user = await requireUser();

  const rows = await query<Item>(
    `SELECT d.id, d.description, d.estimated_cents,
            d.declined_at::text, d.remind_after::text, d.reminded_at::text,
            d.customer_id, c.full_name AS customer_name, c.phone,
            c.sms_opted_out,
            concat_ws(' ', v.year::text, v.make, v.model) AS vehicle,
            (d.remind_after IS NOT NULL
             AND d.remind_after <= now()
             AND d.reminded_at IS NULL) AS due
       FROM declined_work d
       JOIN customers c ON c.id = d.customer_id
       LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.shop_id = $1 AND d.resolved_at IS NULL
      ORDER BY d.remind_after NULLS LAST, d.declined_at DESC`,
    [user.shopId],
  );

  const due = rows.filter((row) => row.due);
  const later = rows.filter((row) => !row.due);

  const money = (items: Item[]) =>
    items.reduce((sum, item) => sum + (item.estimated_cents ?? 0), 0);

  return (
    <>
      <PageHead eyebrow={user.shopName} title="Declined work" />

      <p className="mb-6 max-w-2xl text-[0.9375rem] text-ink-2">
        Everything a customer said no to, and when to bring it up again.{" "}
        <span className="text-ink">
          {formatCents(money(rows))} sitting here
        </span>
        , {formatCents(money(due))} of it ready to be raised today.
      </p>

      <Group
        title="Ready to bring up"
        empty="Nothing due. Anything you record shows up here when its interval comes round."
        items={due}
        timezone={user.timezone}
        highlight
      />

      <div className="mt-8">
        <Group
          title="Later"
          empty="Nothing recorded yet. Add declined work from a repair order — it's the six-month follow-up that pays for itself."
          items={later}
          timezone={user.timezone}
        />
      </div>
    </>
  );
}

function Group({
  title,
  empty,
  items,
  timezone,
  highlight = false,
}: {
  title: string;
  empty: string;
  items: Item[];
  timezone: string;
  highlight?: boolean;
}) {
  return (
    <section>
      <h2 className="t-eyebrow mb-2">{title}</h2>

      {items.length === 0 ? (
        <p className="card p-6 text-center text-[0.875rem] text-ink-2">{empty}</p>
      ) : (
        <ul className="card divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] font-semibold text-ink">
                  {item.description}
                </p>
                <p className="mt-0.5 text-[0.8125rem] text-ink-2">
                  <Link
                    href={`/app/customers/${item.customer_id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {item.customer_name ?? "Unnamed"}
                  </Link>
                  {" · "}
                  <span className="t-data">{formatPhone(item.phone)}</span>
                  {item.vehicle && ` · ${item.vehicle}`}
                  {" · declined "}
                  {new Date(item.declined_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: timezone,
                  })}
                </p>
                {/*
                  A customer who has texted STOP must never be queued for an
                  outbound message — carrier rule, and the schema records it.
                  The item stays on this list, because a phone call by a human
                  is still perfectly allowed.
                */}
                {item.sms_opted_out && (
                  <span className="tag tag-person mt-1.5">
                    No texts — call them
                  </span>
                )}
              </div>

              <span className="t-data w-24 text-right text-[0.9375rem] text-ink">
                {item.estimated_cents === null
                  ? "—"
                  : formatCents(item.estimated_cents)}
              </span>

              {!highlight && (
                <span className="w-32 text-right text-[0.8125rem] text-ink-3">
                  {item.reminded_at
                    ? "raised already"
                    : item.remind_after
                      ? new Date(item.remind_after).toLocaleDateString("en-US", {
                          month: "short",
                          year: "numeric",
                          timeZone: timezone,
                        })
                      : "no reminder"}
                </span>
              )}

              <form action={updateDeclined} className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={item.id} />
                {highlight && (
                  <button
                    type="submit"
                    name="do"
                    value="called"
                    className="btn btn-ghost btn-sm"
                  >
                    Raised it
                  </button>
                )}
                <button
                  type="submit"
                  name="do"
                  value="sold"
                  className="btn btn-emerald btn-sm"
                >
                  They said yes
                </button>
                <button
                  type="submit"
                  name="do"
                  value="dropped"
                  className="btn btn-ghost btn-sm"
                >
                  Drop it
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
