"use client";

import { useActionState } from "react";

import { inviteStaff, type FormState } from "@/app/actions/auth";
import { Field, FormError, Select, Submit } from "@/components/app/field";

export function InviteForm() {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    inviteStaff,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Name"
          name="full_name"
          required
          defaultValue={state?.values?.full_name}
          error={state?.fields?.full_name}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoCapitalize="off"
          spellCheck={false}
          required
          defaultValue={state?.values?.email}
          error={state?.fields?.email}
        />
      </div>

      <Select
        label="Role"
        name="role"
        defaultValue={state?.values?.role ?? "advisor"}
        error={state?.fields?.role}
      >
        <option value="advisor">Service advisor — works the counter</option>
        <option value="tech">Technician — works the bay</option>
        <option value="owner">Owner — everything, including the team</option>
      </Select>

      <Submit className="btn btn-emerald self-start" pendingLabel="Creating…">
        Create invite link
      </Submit>
    </form>
  );
}
