"use client";

import { useActionState } from "react";

import { sendPortalMessage } from "@/app/actions/portal";
import type { FormState } from "@/app/actions/auth";
import { FormError, Submit } from "@/components/app/field";

/**
 * "Message the shop." Lands in the ticket's conversation and rings the bell
 * at the counter. Not a chat: there is no promise of an instant reply, and
 * the wording under the box says so.
 */
export function PortalMessageForm({ token, shopName }: { token: string; shopName: string }) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    sendPortalMessage,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <FormError>{state?.error}</FormError>
      <label htmlFor="portal-message" className="sr-only">
        Your message
      </label>
      <textarea
        id="portal-message"
        name="body"
        rows={3}
        required
        maxLength={1000}
        defaultValue={state?.values?.body ?? ""}
        placeholder={`A question for ${shopName}…`}
        aria-invalid={state?.fields?.body ? true : undefined}
        className={`input leading-relaxed ${state?.fields?.body ? "border-amber-deep" : ""}`}
      />
      {state?.fields?.body && <p className="text-[0.8125rem] text-amber-deep">{state.fields.body}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Submit className="btn btn-ghost btn-sm" pendingLabel="Sending…">
          Send to the shop
        </Submit>
        <span className="text-[0.8125rem] text-ink-3">They&apos;ll see it at the counter and get back to you.</span>
      </div>
    </form>
  );
}
