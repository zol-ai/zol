"use client";

import { useActionState, useState } from "react";

import type { FormState } from "@/app/actions/auth";
import { bookAppointment } from "@/app/actions/appointments";
import { Field, FormError, Select, Submit } from "@/components/app/field";
import { TextArea } from "@/components/app/schedule/text-area";

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

/**
 * Suggestions only — the field is free text because shops don't share a
 * service menu, and the receptionist writes whatever the caller said.
 */
const SERVICE_SUGGESTIONS = [
  "Check-engine diagnostic",
  "Brake service",
  "Oil service",
  "Tires",
  "Electrical diagnostic",
  "Cooling system",
  "Suspension",
  "Alignment",
  "Heating & A/C",
  "Inspection",
  "Routine maintenance",
];

export function BookingForm({
  customerId,
  vehicles,
  repairOrders,
  technicians,
  bayCount,
  defaultDate,
}: {
  customerId: string;
  vehicles: BookingOption[];
  repairOrders: BookingOption[];
  /** Label carries the specialties: "Elena Torres — Brakes, Suspension". */
  technicians: BookingOption[];
  bayCount: number;
  defaultDate: string;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    bookAppointment,
    undefined,
  );
  const v = state?.values;

  /*
    React resets the form once the action returns. Text inputs pick their
    `defaultValue` back up from `state.values`; a <select> does not — React
    leaves a select's default alone after mount — so a rejected booking came
    back with the bay and technician quietly blanked. Remounting the form on
    every returned state makes all of them start from what was typed.
  */
  const [attempt, setAttempt] = useState(0);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setAttempt((n) => n + 1);
  }

  return (
    <form key={attempt} action={action} className="flex flex-col gap-4">
      {/* A double-booked bay or technician lands here, as a sentence naming
          the conflict. */}
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="customer_id" value={customerId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Day"
          name="date"
          type="date"
          required
          defaultValue={v?.date ?? defaultDate}
          error={state?.fields?.date}
        />
        <Field
          label="Time"
          name="time"
          type="time"
          required
          defaultValue={v?.time ?? "09:00"}
          error={state?.fields?.time}
        />
        <Select
          label="In for"
          name="minutes"
          defaultValue={v?.minutes ?? "60"}
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
          defaultValue={v?.bay ?? ""}
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Technician"
          name="technician_id"
          defaultValue={v?.technician_id ?? ""}
          error={state?.fields?.technician_id}
          hint={
            technicians.length === 0
              ? "No technicians on the team yet — add them under Team."
              : "Checked for a clash with their other bookings."
          }
        >
          <option value="">Any technician — assign later</option>
          {technicians.map((tech) => (
            <option key={tech.id} value={tech.id}>
              {tech.label}
            </option>
          ))}
        </Select>
        <Field
          label="Service"
          name="service_type"
          list="service-types"
          placeholder="Check-engine diagnostic"
          maxLength={80}
          defaultValue={v?.service_type ?? ""}
          error={state?.fields?.service_type}
          hint="What kind of visit. Free text; the list is just a nudge."
        />
        <datalist id="service-types">
          {SERVICE_SUGGESTIONS.map((service) => (
            <option key={service} value={service} />
          ))}
        </datalist>
      </div>

      {vehicles.length > 0 && (
        <Select label="Vehicle" name="vehicle_id" defaultValue={v?.vehicle_id ?? vehicles[0].id}>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.label}
            </option>
          ))}
          <option value="">Not sure yet</option>
        </Select>
      )}

      {repairOrders.length > 0 && (
        <Select label="Repair order" name="repair_order_id" defaultValue={v?.repair_order_id ?? ""}>
          <option value="">None</option>
          {repairOrders.map((ro) => (
            <option key={ro.id} value={ro.id}>
              {ro.label}
            </option>
          ))}
        </Select>
      )}

      <TextArea
        label="Complaint"
        name="complaint"
        rows={2}
        maxLength={500}
        placeholder="Check engine light is on and it shakes at idle"
        defaultValue={v?.complaint ?? ""}
        error={state?.fields?.complaint}
        hint="Their words. It goes on the ticket at check-in."
      />

      <TextArea
        label="Notes for the shop"
        name="notes"
        rows={2}
        maxLength={1000}
        placeholder="Dropping off the night before; keys in the box"
        defaultValue={v?.notes ?? ""}
        error={state?.fields?.notes}
      />

      <Submit className="btn btn-emerald self-start">Book it</Submit>
    </form>
  );
}
