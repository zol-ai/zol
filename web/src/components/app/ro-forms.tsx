"use client";

import { useActionState } from "react";

import type { FormState } from "@/app/actions/auth";
import {
  addLine,
  createRepairOrder,
  saveRepairOrder,
} from "@/app/actions/repair-orders";
import { STATUS_LABEL, type Status } from "@/lib/repair-orders";
import { Field, FormError, Select, Submit } from "@/components/app/field";

export interface VehicleOption {
  id: string;
  label: string;
}

/** Opening a ticket. Complaint in the customer's words, and nothing else required. */
export function NewRepairOrderForm({
  customerId,
  vehicles,
}: {
  customerId: string;
  vehicles: VehicleOption[];
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    createRepairOrder,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="customer_id" value={customerId} />

      {vehicles.length > 0 && (
        <Select label="Vehicle" name="vehicle_id" error={state?.fields?.vehicle_id}>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.label}
            </option>
          ))}
          <option value="">Not sure yet</option>
        </Select>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="complaint" className="text-[0.8125rem] font-semibold text-ink-2">
          Complaint
        </label>
        <textarea
          id="complaint"
          name="complaint"
          rows={3}
          required
          defaultValue={state?.values?.complaint}
          placeholder="Grinding from the front when braking, worse when cold"
          className="w-full rounded-[var(--radius)] border border-line-2 bg-paper px-3 py-2.5 text-[0.9375rem] text-ink"
        />
        <p className="text-[0.8125rem] text-ink-3">
          {state?.fields?.complaint ?? "Their words, not a diagnosis."}
        </p>
      </div>

      <Field
        label="Mileage in"
        name="mileage"
        inputMode="numeric"
        defaultValue={state?.values?.mileage}
        error={state?.fields?.mileage}
      />

      <Submit className="btn btn-emerald self-start">Open repair order</Submit>
    </form>
  );
}

export interface RepairOrderRecord {
  id: string;
  complaint: string | null;
  cause: string | null;
  correction: string | null;
  status: Status;
  mileage_in: number | null;
}

/** The three C's and the status. What an advisor edits all day. */
export function RepairOrderForm({ ro }: { ro: RepairOrderRecord }) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    saveRepairOrder,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="id" value={ro.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Status"
          name="status"
          defaultValue={ro.status}
          error={state?.fields?.status}
        >
          {(Object.keys(STATUS_LABEL) as Status[]).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
        <Field
          label="Mileage in"
          name="mileage"
          inputMode="numeric"
          defaultValue={ro.mileage_in ?? ""}
          error={state?.fields?.mileage}
        />
      </div>

      {/* Complaint, cause, correction — the three lines every shop writes on
          the ticket, and the three the agent has to fill in from a call. */}
      <ThreeC name="complaint" label="Complaint" value={ro.complaint} hint="What they told you." />
      <ThreeC name="cause" label="Cause" value={ro.cause} hint="What you found." />
      <ThreeC
        name="correction"
        label="Correction"
        value={ro.correction}
        hint="What you did about it."
      />

      <Submit className="btn btn-emerald self-start">Save</Submit>
    </form>
  );
}

function ThreeC({
  name,
  label,
  value,
  hint,
}: {
  name: string;
  label: string;
  value: string | null;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-[0.8125rem] font-semibold text-ink-2">
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={2}
        defaultValue={value ?? ""}
        className="w-full rounded-[var(--radius)] border border-line-2 bg-paper px-3 py-2.5 text-[0.9375rem] text-ink"
      />
      <p className="text-[0.8125rem] text-ink-3">{hint}</p>
    </div>
  );
}

/** Add a line. Labour is hours × rate; a part is count × price. */
export function AddLineForm({
  repairOrderId,
  laborRate,
}: {
  repairOrderId: string;
  laborRate: string;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    addLine,
    undefined,
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[9rem_1fr_5rem_7rem_auto]">
      <Select label="Kind" name="kind" defaultValue={state?.values?.kind ?? "labor"}>
        <option value="labor">Labour</option>
        <option value="part">Part</option>
        <option value="fee">Fee</option>
        <option value="discount">Discount</option>
      </Select>
      <Field
        label="Description"
        name="description"
        required
        defaultValue={state?.values?.description}
        error={state?.fields?.description}
      />
      <Field
        label="Qty / hrs"
        name="quantity"
        inputMode="decimal"
        defaultValue={state?.values?.quantity ?? "1"}
        error={state?.fields?.quantity}
      />
      <Field
        label="Unit"
        name="unit"
        inputMode="decimal"
        required
        placeholder={laborRate}
        defaultValue={state?.values?.unit}
        error={state?.fields?.unit}
      />
      <input type="hidden" name="repair_order_id" value={repairOrderId} />
      <div className="flex items-end">
        <Submit className="btn btn-ghost w-full sm:w-auto">Add</Submit>
      </div>
    </form>
  );
}
