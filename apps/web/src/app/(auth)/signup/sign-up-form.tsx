"use client";

import { useActionState } from "react";

import { signUp, type FormState } from "@/app/actions/auth";
import { Field, FormError, Submit } from "@/components/app/field";

export function SignUpForm({ codeRequired }: { codeRequired: boolean }) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    signUp,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>

      <Field
        label="Shop name"
        name="shop_name"
        autoComplete="organization"
        required
        placeholder="Vasquez Auto Repair"
        defaultValue={state?.values?.shop_name}
        error={state?.fields?.shop_name}
      />

      <Field
        label="Your name"
        name="full_name"
        autoComplete="name"
        required
        defaultValue={state?.values?.full_name}
        error={state?.fields?.full_name}
      />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
        required
        defaultValue={state?.values?.email}
        error={state?.fields?.email}
      />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        error={state?.fields?.password}
        hint="At least 10 characters."
      />

      {codeRequired && (
        <Field
          label="Invite code"
          name="code"
          required
          error={state?.fields?.code}
          hint="From whoever set up your demo."
        />
      )}

      <Submit pendingLabel="Setting up…">Create the shop</Submit>

      <p className="text-[0.8125rem] leading-relaxed text-ink-3">
        You&rsquo;ll be the owner on this shop and can add advisors and techs
        afterwards. Hours default to 8–5 Monday to Friday; change them in
        settings.
      </p>
    </form>
  );
}
