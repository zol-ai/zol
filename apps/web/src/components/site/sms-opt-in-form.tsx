"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { submitSmsOptIn, type SmsOptInState } from "@/app/actions/sms-opt-in";
import { Checkbox, Field, FormError, Submit } from "@/components/app/field";
import { site } from "@/lib/site";
import { SMS_CONSENT_TEXT } from "@/lib/sms-consent";
import { HONEYPOT } from "@/lib/waitlist";

/**
 * The opt-in form for ZOL INC's support texts. Same primitives as the
 * waitlist, same rules: the server validates everything, the consent box is
 * never pre-ticked, and submitting with the box clear is refused.
 *
 * `data-export` marks the card the PNG export screenshots.
 */
export function SmsOptInForm() {
  const [state, action] = useActionState<SmsOptInState | undefined, FormData>(
    submitSmsOptIn,
    undefined,
  );
  const confirmation = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state?.ok) confirmation.current?.focus();
  }, [state?.ok]);

  if (state?.ok) {
    return (
      <div
        ref={confirmation}
        tabIndex={-1}
        role="status"
        className="card p-6 focus:outline-none sm:p-8"
      >
        <p className="t-eyebrow inline-flex items-center gap-2.5">
          <span className="dot dot-live" aria-hidden="true" />
          Consent recorded
        </p>
        <h3 className="t-h3 mt-4 text-[1.375rem]">Thanks, you&rsquo;re opted in</h3>
        <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink-2">
          We&rsquo;ve recorded your consent with the date and the wording you agreed to.
          You&rsquo;ll get a confirmation text from {site.company.legalName} once our support
          line is live. Reply STOP at any time to opt out, or HELP for help.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="card flex flex-col gap-5 p-6 sm:p-8" data-export="form">
      <div>
        <p className="t-eyebrow">Opt in to ZOL support texts</p>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-2">
          For shop owners and staff who are {site.name} customers. Nothing is sent until
          you tick the box and submit.
        </p>
      </div>

      <FormError>{state?.error}</FormError>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
      >
        <label htmlFor={`sms-${HONEYPOT}`}>Company website</label>
        <input
          id={`sms-${HONEYPOT}`}
          name={HONEYPOT}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Your name"
          name="full_name"
          id="sms_full_name"
          autoComplete="name"
          required
          defaultValue={state?.values?.full_name}
          error={state?.fields?.full_name}
        />
        <Field
          label="Shop name"
          name="shop_name"
          id="sms_shop_name"
          autoComplete="organization"
          required
          defaultValue={state?.values?.shop_name}
          error={state?.fields?.shop_name}
        />
      </div>

      <Field
        label="Mobile number"
        name="phone"
        id="sms_phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        placeholder="(530) 555-0148"
        defaultValue={state?.values?.phone}
        error={state?.fields?.phone}
        hint="The mobile you'd like support and account texts on."
      />

      <Checkbox
        name="consent"
        required
        defaultChecked={state?.values?.consent === "on"}
        error={state?.fields?.consent}
      >
        {SMS_CONSENT_TEXT} See our{" "}
        <Link href={site.termsPath} className="font-semibold text-ink underline underline-offset-4">
          Terms
        </Link>{" "}
        and{" "}
        <Link href={site.privacyPath} className="font-semibold text-ink underline underline-offset-4">
          Privacy Policy
        </Link>
        .
      </Checkbox>

      <Submit className="btn btn-emerald self-start" pendingLabel="Recording…">
        Opt in to support texts
      </Submit>
    </form>
  );
}
