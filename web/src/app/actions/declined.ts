"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { parseCents } from "@/lib/money";
import type { FormState } from "./auth";

/**
 * Work the customer said no to.
 *
 * This is the least glamorous table in the schema and probably the most
 * valuable one. A shop finds $600 of worn suspension on a car in for brakes,
 * the customer says "not today", and unless somebody writes it down it is
 * gone. Six months later the same car comes in with the same problem, worse,
 * and often at a different shop.
 *
 * Recording it is the whole feature today. Chasing it automatically needs the
 * phone line, which is waiting on carrier registration — so "we called them"
 * is a button a human presses, and the same rows will feed the automatic
 * recall the day telephony is switched on.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function recordDeclined(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const customerId = text(form, "customer_id");
  const vehicleId = text(form, "vehicle_id");
  const repairOrderId = text(form, "repair_order_id");
  const description = text(form, "description");
  const rawEstimate = text(form, "estimate");
  const months = Number(text(form, "months") || "6");

  const values = { description, estimate: rawEstimate, months: String(months) };
  const fields: Record<string, string> = {};

  if (description.length < 3) fields.description = "What did they turn down?";
  const estimate = rawEstimate ? parseCents(rawEstimate) : null;
  if (rawEstimate && estimate === undefined) {
    fields.estimate = "A dollar amount, or leave it empty.";
  }
  if (![0, 1, 3, 6, 12].includes(months)) fields.months = "Pick an interval.";
  if (Object.keys(fields).length > 0) return { fields, values };

  const owner = await query<{ id: string }>(
    "SELECT id FROM customers WHERE id = $1 AND shop_id = $2",
    [customerId, user.shopId],
  );
  if (owner.length === 0) redirect("/app/customers");

  await query(
    `INSERT INTO declined_work
       (shop_id, customer_id, vehicle_id, repair_order_id, description,
        estimated_cents, remind_after)
     VALUES ($1, $2, $3, $4, $5, $6,
             CASE WHEN $7::int = 0 THEN NULL
                  ELSE now() + interval '1 month' * $7::int END)`,
    [
      user.shopId,
      customerId,
      vehicleId || null,
      repairOrderId || null,
      description,
      estimate ?? null,
      months,
    ],
  );

  revalidatePath("/app/declined");
  redirect(
    repairOrderId
      ? `/app/repair-orders/${repairOrderId}?saved=1`
      : `/app/customers/${customerId}`,
  );
}

/**
 * The three things that happen to a declined item.
 *
 * `called` records that somebody has now raised it — the row stops appearing
 * as due without pretending the work was sold. `sold` and `dropped` both close
 * it, and they are kept distinct because "they finally did the struts" and
 * "they sold the car" mean opposite things to whoever reads this list next
 * quarter.
 */
export async function updateDeclined(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const action = text(form, "do");

  const sql: Record<string, string> = {
    called: "UPDATE declined_work SET reminded_at = now()",
    sold: "UPDATE declined_work SET resolved_at = now()",
    dropped: "UPDATE declined_work SET resolved_at = now(), remind_after = NULL",
    snooze:
      "UPDATE declined_work SET remind_after = now() + interval '3 months', reminded_at = NULL",
  };

  if (!sql[action]) redirect("/app/declined");

  await query(`${sql[action]} WHERE id = $1 AND shop_id = $2`, [id, user.shopId]);

  revalidatePath("/app/declined");
  redirect("/app/declined");
}
