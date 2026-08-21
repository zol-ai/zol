"use client";

import { useActionState } from "react";

import type { FormState } from "@/app/actions/auth";
import { saveCustomer, saveVehicle } from "@/app/actions/customers";
import { Field, FormError, Submit } from "@/components/app/field";

export interface CustomerRecord {
  id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  birthday: string | null;
  notes: string | null;
}

export interface VehicleRecord {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  plate: string | null;
  mileage: number | null;
}

export function CustomerForm({
  customer,
  submitLabel = "Save",
}: {
  customer?: CustomerRecord;
  submitLabel?: string;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    saveCustomer,
    undefined,
  );
  const v = state?.values;

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>
      {customer && <input type="hidden" name="id" value={customer.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Name"
          name="full_name"
          autoComplete="off"
          required
          defaultValue={v?.full_name ?? customer?.full_name ?? ""}
          error={state?.fields?.full_name}
        />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          inputMode="tel"
          required
          defaultValue={v?.phone ?? customer?.phone ?? ""}
          error={state?.fields?.phone}
          hint="How ZOL recognises them when they call."
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoCapitalize="off"
          spellCheck={false}
          defaultValue={v?.email ?? customer?.email ?? ""}
          error={state?.fields?.email}
        />
        <Field
          label="Birthday"
          name="birthday"
          type="date"
          defaultValue={v?.birthday ?? customer?.birthday?.slice(0, 10) ?? ""}
          error={state?.fields?.birthday}
          hint="Only if they offer it."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-[0.8125rem] font-semibold text-ink-2">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={v?.notes ?? customer?.notes ?? ""}
          className="w-full rounded-[var(--radius)] border border-line-2 bg-paper px-3 py-2.5 text-[0.9375rem] text-ink"
        />
      </div>

      <Submit className="btn btn-emerald self-start">{submitLabel}</Submit>
    </form>
  );
}

export function VehicleForm({
  customerId,
  vehicle,
}: {
  customerId: string;
  vehicle?: VehicleRecord;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    saveVehicle,
    undefined,
  );
  const v = state?.values;

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="customer_id" value={customerId} />
      {vehicle && <input type="hidden" name="id" value={vehicle.id} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <Field
          label="Year"
          name="year"
          inputMode="numeric"
          maxLength={4}
          defaultValue={v?.year ?? vehicle?.year ?? ""}
          error={state?.fields?.year}
        />
        <Field
          label="Make"
          name="make"
          required
          defaultValue={v?.make ?? vehicle?.make ?? ""}
          error={state?.fields?.make}
        />
        <Field
          label="Model"
          name="model"
          required
          defaultValue={v?.model ?? vehicle?.model ?? ""}
          error={state?.fields?.model}
        />
        <Field
          label="Trim"
          name="trim"
          defaultValue={v?.trim ?? vehicle?.trim ?? ""}
          error={state?.fields?.trim}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="VIN"
          name="vin"
          maxLength={17}
          autoCapitalize="characters"
          spellCheck={false}
          defaultValue={v?.vin ?? vehicle?.vin ?? ""}
          error={state?.fields?.vin}
          hint="17 characters, off the door jamb."
        />
        <Field
          label="Plate"
          name="plate"
          autoCapitalize="characters"
          spellCheck={false}
          defaultValue={v?.plate ?? vehicle?.plate ?? ""}
          error={state?.fields?.plate}
        />
        <Field
          label="Mileage"
          name="mileage"
          inputMode="numeric"
          defaultValue={v?.mileage ?? vehicle?.mileage ?? ""}
          error={state?.fields?.mileage}
        />
      </div>

      <Submit className="btn btn-emerald self-start">
        {vehicle ? "Save vehicle" : "Add vehicle"}
      </Submit>
    </form>
  );
}
