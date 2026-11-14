"use client";

import { useActionState, useEffect, useRef } from "react";

import { joinWaitlist, type WaitlistState } from "@/app/actions/waitlist";
import { Checkbox, Field, FormError, Select, Submit } from "@/components/app/field";
import { site } from "@/lib/site";
import { BAY_BANDS, HONEYPOT, UTM_KEYS, type UtmKey } from "@/lib/waitlist";

/**
 * The waitlist form.
 *
 * Built on the same primitives as everything behind sign-in — `Field`,
 * `Select`, `Submit`, `FormError` — rather than a second set for the marketing
 * site. They are plain HTML controls with no auth dependency, and a shop owner
 * filling this in on a phone at the counter is exactly who they were drawn
 * for.
 *
 * Validation is the server's, echoed back per field. There is no client-side
 * validation library here for the same reason there isn't one anywhere else in
 * this repo: the server has to check all of it regardless, and a second set of
 * rules in the browser is a second set to keep in step. What the browser does
 * do is native `required` and `type=email`, which costs nothing and catches the
 * empty submit before a round trip.
 */
export function WaitlistForm({
  sourcePage,
  utm,
}: {
  sourcePage: string;
  utm: Partial<Record<UtmKey, string>>;
}) {
  const [state, action] = useActionState<WaitlistState | undefined, FormData>(
    joinWaitlist,
    undefined,
  );

  const confirmation = useRef<HTMLDivElement>(null);

  /*
    The form is gone and something else is in its place, which a screen reader
    on a submit button learns nothing about. Moving focus into the confirmation
    is what actually announces it — role="status" alone reads the text but
    leaves the user's focus on a button that no longer exists.
  */
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
          You&rsquo;re on the list
        </p>

        <h3 className="t-h3 mt-4 text-[1.375rem]">
          {/* PLACEHOLDER COPY — yours to write. */}
          We&rsquo;ll call your shop
        </h3>

        <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink-2">
          {/* PLACEHOLDER COPY — yours to write. */}
          Nothing else to do. We work down the list a few shops at a time and
          call the main line when there&rsquo;s a slot — a real person, not a
          recording. If you&rsquo;d rather not wait, pick a time yourself.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href={site.demoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm"
          >
            Book a demo
          </a>
          <a
            href={`mailto:${site.contactEmail}`}
            className="text-[0.875rem] font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline"
          >
            {site.contactEmail}
          </a>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <FormError>{state?.error}</FormError>

      {/* Where this came from. Read off the URL by the page and carried in
          hidden fields, because a Server Action sees its own request, not the
          one that rendered the page it was submitted from. */}
      <input type="hidden" name="source_page" value={sourcePage} />
      {UTM_KEYS.map((key) => (
        <input key={key} type="hidden" name={key} value={utm[key] ?? ""} />
      ))}

      {/*
        The honeypot. Pushed off-screen rather than hidden with display:none or
        type=hidden — the scripts that matter skip those and fill anything else
        they can find a label for. aria-hidden and tabIndex keep it out of the
        way of anybody using the form for real.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
      >
        <label htmlFor={HONEYPOT}>Company website</label>
        <input
          id={HONEYPOT}
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
          autoComplete="name"
          required
          defaultValue={state?.values?.full_name}
          error={state?.fields?.full_name}
        />
        <Field
          label="Shop name"
          name="shop_name"
          autoComplete="organization"
          required
          defaultValue={state?.values?.shop_name}
          error={state?.fields?.shop_name}
        />
      </div>

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        required
        defaultValue={state?.values?.email}
        error={state?.fields?.email}
      />

      <Field
        label="Shop’s main line"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        placeholder="(661) 555-0148"
        defaultValue={state?.values?.phone}
        error={state?.fields?.phone}
        hint="The number your customers ring. We call it back — that’s the demo."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="ZIP"
          name="zip"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          required
          defaultValue={state?.values?.zip}
          error={state?.fields?.zip}
        />
        {/*
          The key is doing real work. `defaultValue` on an uncontrolled select
          only applies at mount, so when a rejected submit re-renders this form
          the dropdown would snap back to "How many?" while every text field
          keeps what was typed — the shop owner fixes their ZIP and silently
          loses that answer. Keying on the echoed value remounts the select so
          the default is applied again. The alternative is making this
          controlled, which would be the only controlled input in the repo and
          would stop working with scripting off.
        */}
        <Select
          key={`bays-${state?.values?.bays ?? ""}`}
          label="Bays"
          name="bays"
          required
          defaultValue={state?.values?.bays ?? ""}
          error={state?.fields?.bays}
        >
          <option value="" disabled>
            How many?
          </option>
          {BAY_BANDS.map((band) => (
            <option key={band} value={band}>
              {band}
            </option>
          ))}
        </Select>
      </div>

      {/*
        Consent, in the open and unticked.

        We intend to text these numbers, so this is the row that has to hold up
        later: it says phone, text and email in plain words, it is the last
        thing above the button rather than small print under it, and it is
        never pre-filled. `defaultChecked` only ever puts back a tick the
        person made themselves on a submit that bounced.
      */}
      <Checkbox
        name="consent"
        required
        defaultChecked={state?.values?.consent === "on"}
        error={state?.fields?.consent}
      >
        {/* PLACEHOLDER COPY — have a lawyer read this before launch. */}
        Yes, {site.name} can contact me by phone, text message and email about
        getting set up. Message and data rates may apply, and I can stop the
        texts any time by replying STOP.
      </Checkbox>

      <Submit className="btn btn-emerald self-start" pendingLabel="Adding you…">
        Join the waitlist
      </Submit>
    </form>
  );
}
