import Link from "next/link";
import { notFound } from "next/navigation";

import { approveRepairOrder, removeLine } from "@/app/actions/repair-orders";
import { STATUS_LABEL, type Status } from "@/lib/repair-orders";
import {
  AddLineForm,
  RepairOrderForm,
  type RepairOrderRecord,
} from "@/components/app/ro-forms";
import { PageHead } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";

export async function generateMetadata(
  props: PageProps<"/app/repair-orders/[id]">,
) {
  const { id } = await props.params;
  const user = await requireUser();
  const rows = await query<{ number: number }>(
    "SELECT number FROM repair_orders WHERE id = $1 AND shop_id = $2",
    [id, user.shopId],
  );
  return { title: rows[0] ? `RO #${rows[0].number}` : "Repair order" };
}

const KIND_LABEL: Record<string, string> = {
  labor: "Labour",
  part: "Part",
  fee: "Fee",
  discount: "Discount",
};

export default async function RepairOrderPage(
  props: PageProps<"/app/repair-orders/[id]">,
) {
  const user = await requireUser();
  const { id } = await props.params;
  const { saved } = await props.searchParams;

  const rows = await query<
    RepairOrderRecord & {
      number: number;
      customer_id: string;
      customer_name: string | null;
      phone: string;
      vehicle: string | null;
      plate: string | null;
      created_at: string;
      approved_at: string | null;
      approved_by_name: string | null;
      total_cents: number;
      labor_rate_cents: number;
      tax_rate_pct: string;
      auto_quote_cap_cents: number;
    }
  >(
    `SELECT ro.id, ro.number, ro.status, ro.complaint, ro.cause, ro.correction,
            ro.mileage_in, ro.total_cents, ro.created_at::text, ro.approved_at::text,
            ro.customer_id,
            c.full_name AS customer_name, c.phone,
            concat_ws(' ', v.year::text, v.make, v.model, v.trim) AS vehicle,
            v.plate,
            approver.full_name AS approved_by_name,
            s.labor_rate_cents, s.tax_rate_pct, s.auto_quote_cap_cents
       FROM repair_orders ro
       JOIN customers c ON c.id = ro.customer_id
       JOIN shops s ON s.id = ro.shop_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
       LEFT JOIN staff approver ON approver.id = ro.approved_by
      WHERE ro.id = $1 AND ro.shop_id = $2`,
    [id, user.shopId],
  );

  const ro = rows[0];
  if (!ro) notFound();

  const lines = await query<{
    id: string;
    kind: string;
    description: string;
    quantity: string;
    unit_cents: number;
    total_cents: number;
    quoted_by_agent: boolean;
  }>(
    `SELECT id, kind, description, quantity, unit_cents, total_cents,
            quoted_by_agent
       FROM repair_order_lines
      WHERE repair_order_id = $1
      ORDER BY position, created_at`,
    [id],
  );

  // Derived here rather than stored: the header keeps one number, the total,
  // and the breakdown is whatever the lines currently say.
  const subtotal = lines.reduce((sum, line) => sum + line.total_cents, 0);
  const taxable = lines
    .filter((line) => line.kind === "part" || line.kind === "fee")
    .reduce((sum, line) => sum + line.total_cents, 0);
  const tax = ro.total_cents - subtotal;
  const overCap = ro.total_cents > ro.auto_quote_cap_cents;

  return (
    <>
      <PageHead eyebrow={`Repair order #${ro.number}`} title={ro.customer_name ?? "Unnamed"}>
        <Link href="/app/repair-orders" className="btn btn-ghost btn-sm">
          Board
        </Link>
      </PageHead>

      {saved && (
        <p
          role="status"
          className="mb-6 rounded-[var(--radius)] border border-emerald-line bg-emerald-wash px-3 py-2.5 text-[0.875rem] font-semibold text-emerald-deep"
        >
          Saved.
        </p>
      )}

      <div className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
        <Link
          href={`/app/customers/${ro.customer_id}`}
          className="text-[0.9375rem] font-semibold text-ink underline-offset-4 hover:underline"
        >
          {ro.customer_name ?? "Unnamed"}
        </Link>
        <a href={`tel:${ro.phone}`} className="t-data text-[0.9375rem] text-ink-2">
          {formatPhone(ro.phone)}
        </a>
        {ro.vehicle && (
          <span className="text-[0.9375rem] text-ink-2">
            {ro.vehicle}
            {ro.plate && (
              <span className="t-data ml-2 text-[0.8125rem] text-ink-3">
                {ro.plate}
              </span>
            )}
          </span>
        )}
        <span className="tag tag-neutral">{STATUS_LABEL[ro.status as Status]}</span>
      </div>

      {/*
        The cap. Above it, nothing is supposed to reach a customer until a
        person here has said the number out loud is fine. It's the control the
        whole risk of an agent quoting sits behind, so it's stated plainly at
        the top of the ticket rather than buried in settings.
      */}
      {overCap && !ro.approved_at && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-amber-line bg-amber-wash p-4">
          <div>
            <p className="text-[0.9375rem] font-semibold text-amber-deep">
              {formatCents(ro.total_cents)} is over your{" "}
              {formatCents(ro.auto_quote_cap_cents)} cap.
            </p>
            <p className="mt-0.5 text-[0.875rem] text-ink-2">
              Nothing goes to the customer at this price until somebody here
              approves it.
            </p>
          </div>
          <form action={approveRepairOrder}>
            <input type="hidden" name="id" value={ro.id} />
            <button type="submit" className="btn btn-emerald btn-sm">
              Approve this price
            </button>
          </form>
        </div>
      )}

      {ro.approved_at && (
        <p className="mb-6 text-[0.875rem] text-ink-2">
          <span className="tag tag-person mr-2">Approved</span>
          {ro.approved_by_name ?? "Someone"} on{" "}
          {new Date(ro.approved_at).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: user.timezone,
          })}
        </p>
      )}

      <section className="card mb-6 p-5 sm:p-6">
        <h2 className="t-h3 mb-4 text-[1.125rem]">Lines</h2>

        {lines.length === 0 ? (
          <p className="text-[0.875rem] text-ink-2">
            Nothing on the ticket yet. Labour is hours × your rate; a part is
            count × what you charge for it.
          </p>
        ) : (
          <table className="w-full text-left text-[0.875rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="t-eyebrow pb-2 font-semibold">Kind</th>
                <th className="t-eyebrow pb-2 font-semibold">Description</th>
                <th className="t-eyebrow pb-2 text-right font-semibold">Qty</th>
                <th className="t-eyebrow pb-2 text-right font-semibold">Unit</th>
                <th className="t-eyebrow pb-2 text-right font-semibold">Total</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-2.5 text-ink-3">{KIND_LABEL[line.kind]}</td>
                  <td className="py-2.5 text-ink">
                    {line.description}
                    {/* Emerald means ZOL did it with nobody watching — the
                        page's one colour system, used here too. */}
                    {line.quoted_by_agent && (
                      <span className="tag tag-zol ml-2">ZOL</span>
                    )}
                  </td>
                  <td className="t-data py-2.5 text-right text-ink-2">
                    {Number(line.quantity)}
                  </td>
                  <td className="t-data py-2.5 text-right text-ink-2">
                    {formatCents(line.unit_cents)}
                  </td>
                  <td className="t-data py-2.5 text-right text-ink">
                    {formatCents(line.total_cents)}
                  </td>
                  <td className="py-2.5 text-right">
                    <form action={removeLine}>
                      <input type="hidden" name="line_id" value={line.id} />
                      <input type="hidden" name="repair_order_id" value={ro.id} />
                      <button
                        type="submit"
                        className="text-[0.8125rem] text-ink-3 underline-offset-2 hover:text-amber-deep hover:underline"
                        aria-label={`Remove ${line.description}`}
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line-2">
              <tr>
                <td colSpan={4} className="pt-3 text-right text-ink-2">
                  Subtotal
                </td>
                <td className="t-data pt-3 text-right text-ink">
                  {formatCents(subtotal)}
                </td>
                <td />
              </tr>
              <tr>
                <td colSpan={4} className="pt-1 text-right text-ink-2">
                  Tax, {ro.tax_rate_pct}% on {formatCents(taxable)} of parts and
                  fees
                </td>
                <td className="t-data pt-1 text-right text-ink">
                  {formatCents(tax)}
                </td>
                <td />
              </tr>
              <tr>
                <td colSpan={4} className="pt-2 text-right font-semibold text-ink">
                  Total
                </td>
                <td className="t-data pt-2 text-right text-[1.0625rem] font-semibold text-ink">
                  {formatCents(ro.total_cents)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        <div className="mt-6 border-t border-line pt-5">
          <AddLineForm
            repairOrderId={ro.id}
            laborRate={(ro.labor_rate_cents / 100).toFixed(2)}
          />
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="t-h3 mb-4 text-[1.125rem]">The ticket</h2>
        <RepairOrderForm ro={ro} />
      </section>
    </>
  );
}
