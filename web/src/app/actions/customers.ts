"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import type { FormState } from "./auth";

/**
 * Customers and their vehicles.
 *
 * Every statement here is scoped by shop_id from the session, never from the
 * form or the URL. A customer id is a uuid somebody could paste from another
 * tenant's page, and `WHERE id = $1` alone would happily return it. The rule
 * is: the id narrows, the session decides.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optional(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value.length > 0 ? value : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function saveCustomer(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const id = text(form, "id");
  const rawPhone = text(form, "phone");
  const fullName = text(form, "full_name");
  const email = text(form, "email");
  const birthday = text(form, "birthday");
  const notes = optional(form, "notes");

  const values = {
    full_name: fullName,
    phone: rawPhone,
    email,
    birthday,
    notes: notes ?? "",
  };
  const fields: Record<string, string> = {};

  const phone = toE164(rawPhone);
  if (!phone) fields.phone = "Ten digits, or + and a country code.";
  if (fullName.length < 2) fields.full_name = "A name to greet them by.";
  if (email && !EMAIL.test(email)) fields.email = "That doesn't look like an email.";
  // A birthday is only ever volunteered. It drives the birthday follow-up, so
  // a typo'd year is harmless but a typo'd month texts somebody in March.
  if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    fields.birthday = "Use the date picker.";
  }

  if (Object.keys(fields).length > 0) return { fields, values };

  if (id) {
    const updated = await query<{ id: string }>(
      `UPDATE customers
          SET phone = $3, full_name = $4, email = $5, birthday = $6, notes = $7
        WHERE id = $1 AND shop_id = $2
        RETURNING id`,
      [id, user.shopId, phone, fullName, email || null, birthday || null, notes],
    ).catch((error: { code?: string }) => {
      if (error.code === "23505") return [];
      throw error;
    });

    if (updated.length === 0) {
      return {
        values,
        fields: { phone: "Another customer here already has that number." },
      };
    }

    revalidatePath(`/app/customers/${id}`);
    redirect(`/app/customers/${id}`);
  }

  /*
    The phone number is the identity, and the shop will hit this constantly:
    the same person calls, gets typed in again by whoever is at the counter.
    Rather than fail on the unique index, fold into the existing record — and
    only fill in fields that are currently empty, so a re-entry can add an
    email but can never quietly rename somebody.
  */
  const rows = await query<{ id: string }>(
    `INSERT INTO customers (shop_id, phone, full_name, email, birthday, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (shop_id, phone) DO UPDATE
       SET full_name = COALESCE(customers.full_name, EXCLUDED.full_name),
           email     = COALESCE(customers.email, EXCLUDED.email),
           birthday  = COALESCE(customers.birthday, EXCLUDED.birthday),
           notes     = COALESCE(customers.notes, EXCLUDED.notes)
     RETURNING id`,
    [user.shopId, phone, fullName, email || null, birthday || null, notes],
  );

  revalidatePath("/app/customers");
  redirect(`/app/customers/${rows[0].id}`);
}

const CURRENT_YEAR = new Date().getFullYear();

export async function saveVehicle(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const id = text(form, "id");
  const customerId = text(form, "customer_id");
  const year = text(form, "year");
  const make = text(form, "make");
  const model = text(form, "model");
  const trim = optional(form, "trim");
  const vin = text(form, "vin").toUpperCase().replace(/\s/g, "");
  const plate = optional(form, "plate");
  const mileage = text(form, "mileage").replace(/[,\s]/g, "");

  const values = { year, make, model, trim: trim ?? "", vin, plate: plate ?? "", mileage };
  const fields: Record<string, string> = {};

  if (make.length < 1) fields.make = "Make?";
  if (model.length < 1) fields.model = "Model?";
  if (year && !/^\d{4}$/.test(year)) fields.year = "Four digits.";
  if (year && (Number(year) < 1900 || Number(year) > CURRENT_YEAR + 2)) {
    fields.year = `Between 1900 and ${CURRENT_YEAR + 2}.`;
  }
  // 17 characters since 1981, and I, O and Q are excluded from the alphabet
  // precisely so they can't be confused with 1 and 0 — which is exactly the
  // mistake somebody typing one off a door jamb makes.
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    fields.vin = "17 characters, no I, O or Q.";
  }
  if (mileage && !/^\d{1,7}$/.test(mileage)) fields.mileage = "Numbers only.";

  if (Object.keys(fields).length > 0) return { fields, values };

  // Confirm the customer belongs to this shop before hanging a vehicle off it.
  const owner = await query<{ id: string }>(
    "SELECT id FROM customers WHERE id = $1 AND shop_id = $2",
    [customerId, user.shopId],
  );
  if (owner.length === 0) redirect("/app/customers");

  const params = [
    user.shopId,
    customerId,
    year || null,
    make,
    model,
    trim,
    vin || null,
    plate,
    mileage || null,
  ];

  try {
    if (id) {
      await query(
        `UPDATE vehicles
            SET year = $3, make = $4, model = $5, trim = $6,
                vin = $7, plate = $8, mileage = $9
          WHERE id = $10 AND shop_id = $1 AND customer_id = $2`,
        [...params, id],
      );
    } else {
      await query(
        `INSERT INTO vehicles
           (shop_id, customer_id, year, make, model, trim, vin, plate, mileage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        params,
      );
    }
  } catch (error) {
    // vehicles_shop_vin: one VIN is one car, and a shop typing it twice means
    // the car is already on file under somebody — often the previous owner.
    if ((error as { code?: string }).code === "23505") {
      return {
        values,
        fields: { vin: "That VIN is already on another vehicle here." },
      };
    }
    throw error;
  }

  revalidatePath(`/app/customers/${customerId}`);
  redirect(`/app/customers/${customerId}`);
}
