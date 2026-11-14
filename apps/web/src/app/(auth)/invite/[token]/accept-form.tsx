"use client";

import { useActionState } from "react";

import { acceptInvite, type FormState } from "@/app/actions/auth";
import { Field, FormError, Submit } from "@/components/app/field";

export function AcceptForm({
  token,
  fullName,
}: {
  token: string;
  fullName: string;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    acceptInvite,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>

      {/* The invite itself. The email and role come from the stored row, not
          from this form — otherwise anyone holding a link could pick their
          own role. */}
      <input type="hidden" name="token" value={token} />

      <Field
        label="Your name"
        name="full_name"
        autoComplete="name"
        required
        defaultValue={state?.values?.full_name ?? fullName}
        error={state?.fields?.full_name}
      />

      <Field
        label="Choose a password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        error={state?.fields?.password}
        hint="At least 10 characters."
      />

      <Submit pendingLabel="Setting up…">Join the shop</Submit>
    </form>
  );
}
