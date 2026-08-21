"use server";

import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { recalculateOpen } from "@/lib/ro-totals";
import type { FormState } from "./auth";

/**
 * Shop settings.
 *
 * These numbers are what ZOL is allowed to say out loud on a phone call: the
 * labour rate it multiplies book hours by, the margin it adds to a part, and
 * the ceiling above which it stops and asks a human. Nothing here is cosmetic,
 * so everything is owner-only and everything is validated on the way in — a
 * fat-fingered labour rate of 1450 instead of 145.00 would quote a brake job
 * at ten times the price, on a call nobody was listening to.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Dollars as typed by a human → integer cents. Rejects anything that isn't money. */
function cents(raw: string): number | undefined {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
}

function percent(raw: string): number | undefined {
  const cleaned = raw.replace(/[%\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  const value = Number(cleaned);
  return value >= 0 && value <= 100 ? value : undefined;
}

export async function saveShop(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireRole("owner");

  const name = text(form, "name");
  const timezone = text(form, "timezone");
  const bays = Number(text(form, "bay_count"));
  const labor = cents(text(form, "labor_rate"));
  const margin = percent(text(form, "parts_margin_pct"));
  const tax = percent(text(form, "tax_rate_pct"));
  const cap = cents(text(form, "auto_quote_cap"));

  const fields: Record<string, string> = {};
  if (name.length < 2) fields.name = "The shop needs a name.";
  if (!Number.isInteger(bays) || bays < 1 || bays > 60) {
    fields.bay_count = "Somewhere between 1 and 60.";
  }
  if (labor === undefined) fields.labor_rate = "A dollar amount, like 145.00.";
  if (margin === undefined) fields.parts_margin_pct = "A percentage, 0 to 100.";
  if (tax === undefined) fields.tax_rate_pct = "A percentage, 0 to 100.";
  if (cap === undefined) fields.auto_quote_cap = "A dollar amount, like 1000.00.";

  // Postgres will reject an unknown zone anyway; catching it here gives the
  // owner a sentence instead of a 500.
  if (timezone) {
    const known = await query<{ ok: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1) AS ok",
      [timezone],
    );
    if (!known[0]?.ok) fields.timezone = "Not a time zone Postgres knows.";
  }

  if (Object.keys(fields).length > 0) return { fields };

  /*
    The CTE captures the rate as it was before the UPDATE — RETURNING alone
    would report the value just written and the comparison would never be
    true. FOR UPDATE takes the row lock the write needs anyway, so nothing
    else can move the rate between the read and the write.
  */
  const changed = await query<{ tax_changed: boolean }>(
    `WITH before AS (
       SELECT tax_rate_pct FROM shops WHERE id = $1 FOR UPDATE
     )
     UPDATE shops
        SET name = $2, timezone = $3, bay_count = $4,
            labor_rate_cents = $5, parts_margin_pct = $6,
            tax_rate_pct = $7, auto_quote_cap_cents = $8
       FROM before
      WHERE shops.id = $1
      RETURNING before.tax_rate_pct <> $7 AS tax_changed`,
    [user.shopId, name, timezone, bays, labor, margin, tax, cap],
  );

  /*
    A moved tax rate makes every open ticket's stored total wrong by the
    difference — and that total is the number an advisor reads down the phone.
    Restate them. Closed tickets are left alone: they record what was actually
    charged at the time.
  */
  if (changed[0]?.tax_changed) await recalculateOpen(user.shopId);

  redirect("/app/settings?saved=shop");
}

export async function saveHours(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireRole("owner");

  const days = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    closed: form.get(`closed_${day}`) === "on",
    opens: text(form, `opens_${day}`),
    closes: text(form, `closes_${day}`),
  }));

  const fields: Record<string, string> = {};
  for (const day of days) {
    if (day.closed) continue;
    if (!/^\d{2}:\d{2}$/.test(day.opens) || !/^\d{2}:\d{2}$/.test(day.closes)) {
      fields[`opens_${day.day}`] = "Needs an opening and a closing time.";
    } else if (day.opens >= day.closes) {
      // The schema's CHECK enforces this too. Saying it here means the owner
      // sees which day is wrong rather than a constraint violation.
      fields[`opens_${day.day}`] = "Closing time has to be after opening.";
    }
  }
  if (Object.keys(fields).length > 0) return { fields };

  await tx(async (client) => {
    for (const day of days) {
      await client.query(
        `INSERT INTO shop_hours (shop_id, day_of_week, opens_at, closes_at, is_closed)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (shop_id, day_of_week) DO UPDATE
           SET opens_at = EXCLUDED.opens_at,
               closes_at = EXCLUDED.closes_at,
               is_closed = EXCLUDED.is_closed`,
        [
          user.shopId,
          day.day,
          day.closed ? null : day.opens,
          day.closed ? null : day.closes,
          day.closed,
        ],
      );
    }
  });

  redirect("/app/settings?saved=hours");
}
