"use client";

import { useActionState } from "react";

import type { FormState } from "@/app/actions/auth";
import { saveTechnicianProfile } from "@/app/actions/technicians";
import { Field, FormError, Submit } from "@/components/app/field";

/**
 * Specialties and a phone for one person on the team. Owner-only on the
 * server; shown on the team page and on the technician board's columns, so
 * the owner can fix "Manny does electrical too" wherever they notice it.
 */
export function ProfileForm({
  staff,
  returnTo,
}: {
  staff: { id: string; full_name: string; specialties: string[]; phone: string | null };
  returnTo: string;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    saveTechnicianProfile,
    undefined,
  );
  const v = state?.values;

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError>{state?.error}</FormError>
      <input type="hidden" name="staff_id" value={staff.id} />
      <input type="hidden" name="return_to" value={returnTo} />

      <Field
        label="Specialties"
        name={`specialties-${staff.id}`}
        placeholder="Diagnostics, Brakes, Electrical"
        defaultValue={v?.specialties ?? staff.specialties.join(", ")}
        error={state?.fields?.specialties}
        hint="Comma separated. ZOL prefers a tech whose specialty matches the complaint when it books."
      />
      <Field
        label="Phone"
        name={`phone-${staff.id}`}
        type="tel"
        inputMode="tel"
        defaultValue={v?.phone ?? staff.phone ?? ""}
        error={state?.fields?.phone}
      />

      <Submit className="btn btn-ghost btn-sm self-start" pendingLabel="Saving…">
        Save {staff.full_name.split(" ")[0]}
      </Submit>
    </form>
  );
}
