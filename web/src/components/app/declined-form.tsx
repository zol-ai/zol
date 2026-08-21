"use client";

import { useActionState } from "react";

import type { FormState } from "@/app/actions/auth";
import { recordDeclined } from "@/app/actions/declined";
import { Field, FormError, Select, Submit } from "@/components/app/field";

/**
 * Six months is the default because that's roughly when a car comes back for
 * its next service, and raising declined work while the customer is already
 * standing at the counter is the version that sells.
 */
const INTERVALS: [number, string][] = [
  [1, "Bring it up in a month"],
  [3, "In three months"],
  [6, "In six months"],
  [12, "In a year"],
  [0, "Never — just record it"],
];

export function DeclinedForm({
  customerId,
  vehicleId,
  repairOrderId,
}: {
  customerId: string;
  vehicleId?: string | null;
  repairOrderId?: string | null;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    recordDeclined,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="customer_id" value={customerId} />
      {vehicleId && <input type="hidden" name="vehicle_id" value={vehicleId} />}
      {repairOrderId && (
        <input type="hidden" name="repair_order_id" value={repairOrderId} />
      )}

      <Field
        label="What they turned down"
        name="description"
        required
        placeholder="Front struts, both sides — leaking"
        defaultValue={state?.values?.description}
        error={state?.fields?.description}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="What it would have been"
          name="estimate"
          inputMode="decimal"
          defaultValue={state?.values?.estimate}
          error={state?.fields?.estimate}
          hint="Roughly is fine. Leave empty if you didn't price it."
        />
        <Select
          label="Chase it"
          name="months"
          defaultValue={state?.values?.months ?? "6"}
          error={state?.fields?.months}
        >
          {INTERVALS.map(([months, label]) => (
            <option key={months} value={months}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <Submit className="btn btn-ghost self-start">Record it</Submit>
    </form>
  );
}
