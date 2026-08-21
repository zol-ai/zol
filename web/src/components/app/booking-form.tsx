"use client";

import { useActionState } from "react";

import type { FormState } from "@/app/actions/auth";
import { bookAppointment } from "@/app/actions/appointments";
import { Field, FormError, Select, Submit } from "@/components/app/field";

export interface BookingOption {
  id: string;
  label: string;
}

/** How long a job is in for. Shop language, not minutes in a box. */
const DURATIONS: [number, string][] = [
  [30, "30 minutes"],
  [60, "1 hour"],
  [90, "1½ hours"],
  [120, "2 hours"],
  [180, "3 hours"],
  [240, "Half a day"],
  [480, "All day"],
];

export function BookingForm({
  customerId,
  vehicles,
  repairOrders,
  bayCount,
  defaultDate,
}: {
  customerId: string;
  vehicles: BookingOption[];
  repairOrders: BookingOption[];
  bayCount: number;
  defaultDate: string;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    bookAppointment,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {/* A double-booked bay lands here, as a sentence naming the bay. */}
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="customer_id" value={customerId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Day"
          name="date"
          type="date"
          required
          defaultValue={state?.values?.date ?? defaultDate}
          error={state?.fields?.date}
        />
        <Field
          label="Time"
          name="time"
          type="time"
          required
          defaultValue={state?.values?.time ?? "09:00"}
          error={state?.fields?.time}
        />
        <Select
          label="In for"
          name="minutes"
          defaultValue={state?.values?.minutes ?? "60"}
          error={state?.fields?.minutes}
        >
          {DURATIONS.map(([minutes, label]) => (
            <option key={minutes} value={minutes}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          label="Bay"
          name="bay"
          defaultValue={state?.values?.bay ?? ""}
          error={state?.fields?.bay}
        >
          <option value="">Decide later</option>
          {Array.from({ length: bayCount }, (_, index) => index + 1).map((bay) => (
            <option key={bay} value={bay}>
              Bay {bay}
            </option>
          ))}
        </Select>
      </div>

      {vehicles.length > 0 && (
        <Select label="Vehicle" name="vehicle_id">
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.label}
            </option>
          ))}
          <option value="">Not sure yet</option>
        </Select>
      )}

      {repairOrders.length > 0 && (
        <Select label="Repair order" name="repair_order_id" defaultValue="">
          <option value="">None</option>
          {repairOrders.map((ro) => (
            <option key={ro.id} value={ro.id}>
              {ro.label}
            </option>
          ))}
        </Select>
      )}

      <Submit className="btn btn-emerald self-start">Book it</Submit>
    </form>
  );
}
