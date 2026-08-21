"use client";

import { useActionState } from "react";

import { signIn, type FormState } from "@/app/actions/auth";
import { Field, FormError, Submit } from "@/components/app/field";

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    signIn,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>

      {/* Where to land after sign-in. Validated server-side as a same-site
          path — a value from the URL must never become an open redirect. */}
      {next && <input type="hidden" name="next" value={next} />}

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
        autoComplete="current-password"
        required
        error={state?.fields?.password}
      />

      <Submit pendingLabel="Signing in…">Sign in</Submit>
    </form>
  );
}
