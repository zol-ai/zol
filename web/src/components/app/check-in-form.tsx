"use client";

import { useActionState, useState } from "react";

import { checkInAppointment } from "@/app/actions/appointments";
import type { FormState } from "@/app/actions/auth";
import { Field, FormError, Select, Submit } from "@/components/app/field";
import { TextArea } from "@/components/app/schedule/text-area";

export interface TechnicianOption {
  id: string;
  label: string;
}

/**
 * The car is here. An "Arrived" button that unfolds into the check-in —
 * mileage, fuel, damage, notes, who's taking it, when it was promised — and
 * submits to `checkInAppointment`, which opens the ticket and lands the
 * advisor on it.
 *
 * Inline rather than a separate page because it's filled in standing next to
 * the car with the keys in one hand. The button and the panel are siblings in
 * the slot's action row: the panel takes `basis-full` so it wraps under the
 * buttons instead of squeezing between them.
 */
export function CheckInForm({
  appointmentId,
  date,
  technicians,
  defaultTechnicianId,
  complaint,
  mileage,
  initiallyOpen = false,
}: {
  appointmentId: string;
  date: string;
  technicians: TechnicianOption[];
  defaultTechnicianId: string | null;
  complaint: string | null;
  /** The newest reading on file, as a starting point. */
  mileage: number | null;
  /** Start unfolded — the dashboard's Check in button lands here. */
  initiallyOpen?: boolean;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    checkInAppointment,
    undefined,
  );
  const [open, setOpen] = useState(initiallyOpen);

  /*
    A rejected submit comes back as a new `state`: the panel must be showing
    for the errors to be seen, and the form is remounted so the technician
    <select> starts from what was chosen — React resets the form after the
    action and does not re-apply a select's changed `defaultValue`.
  */
  const [attempt, setAttempt] = useState(0);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setOpen(true);
    setAttempt((n) => n + 1);
  }

  const v = state?.values;

  return (
    <>
      <button
        type="button"
        className="btn btn-emerald btn-sm"
        aria-expanded={open}
        aria-controls={`check-in-${appointmentId}`}
        onClick={() => setOpen((value) => !value)}
      >
        Arrived
      </button>

      {open && (
        <div
          id={`check-in-${appointmentId}`}
          className="basis-full rounded-[var(--radius)] border border-emerald-line bg-emerald-wash/50 p-4"
        >
          <form key={attempt} action={action} className="flex flex-col gap-4">
            <p className="t-eyebrow">Check-in</p>
            <FormError>{state?.error}</FormError>
            <input type="hidden" name="appointment_id" value={appointmentId} />
            <input type="hidden" name="date" value={date} />

            <div className="grid gap-4 sm:grid-cols-3">
              {/* Two arrivals can be unfolded at once, so ids carry the booking. */}
              <Field
                id={`checkin-${appointmentId}-mileage`}
                label="Mileage"
                name="mileage"
                inputMode="numeric"
                placeholder="102430"
                defaultValue={v?.mileage ?? (mileage != null ? String(mileage) : "")}
                error={state?.fields?.mileage}
                hint="Off the dash, now."
              />
              {/*
                No step: the action and the column take any whole percent,
                and a step of 5 would have the browser refuse "33" read off
                the dash before the form ever reached them.
              */}
              <Field
                id={`checkin-${appointmentId}-fuel`}
                label="Fuel %"
                name="fuel"
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                defaultValue={v?.fuel ?? "50"}
                error={state?.fields?.fuel}
              />
              <Field
                id={`checkin-${appointmentId}-promised`}
                label="Promised by"
                name="promised"
                type="datetime-local"
                defaultValue={v?.promised ?? ""}
                error={state?.fields?.promised}
                hint="Leave blank if you don't know yet."
              />
            </div>

            <Select
              id={`checkin-${appointmentId}-technician`}
              label="Technician"
              name="technician_id"
              defaultValue={v?.technician_id ?? defaultTechnicianId ?? ""}
              error={state?.fields?.technician_id}
            >
              <option value="">Assign later</option>
              {technicians.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.label}
                </option>
              ))}
            </Select>

            <TextArea
              label="Complaint"
              name="complaint"
              rows={2}
              maxLength={500}
              defaultValue={v?.complaint ?? complaint ?? ""}
              error={state?.fields?.complaint}
              hint="Their words. This opens the ticket."
            />

            <TextArea
              label="Visible damage"
              name="damage"
              rows={2}
              maxLength={1000}
              placeholder="Scuff on the rear bumper, chip in the windscreen"
              defaultValue={v?.damage ?? ""}
              error={state?.fields?.damage}
            />

            <TextArea
              label="Notes"
              name="notes"
              rows={2}
              maxLength={1000}
              placeholder="Wants a call before anything over $500"
              defaultValue={v?.notes ?? ""}
              error={state?.fields?.notes}
            />

            <div className="flex flex-wrap gap-2">
              <Submit className="btn btn-emerald btn-sm" pendingLabel="Opening the ticket…">
                Open the ticket
              </Submit>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Not yet
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
