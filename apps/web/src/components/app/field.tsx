"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * The form primitives every screen behind sign-in uses.
 *
 * Deliberately plain HTML controls. A shop's counter machine is a five-year-old
 * Windows box in a room with the door open, and the person typing is holding a
 * phone in the other hand — a native input that the browser can autofill beats
 * anything custom.
 */

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
};

/**
 * The id defaults to the name, which is right for a page with one form and
 * wrong the moment two forms share a page — the ticket has an add-line box
 * and a declined-work box that both post a `description`. Pass `id` there;
 * `name` stays what the action reads, and the label, the error and the hint
 * all follow the id so they point at the box they belong to.
 */
export function Field({ label, name, id: idProp, error, hint, ...input }: FieldProps) {
  const id = idProp ?? name;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[0.8125rem] font-semibold text-ink-2"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-[var(--radius)] border bg-paper px-3 py-2.5 text-[0.9375rem] text-ink placeholder:text-ink-3/70 ${
          error ? "border-amber-deep" : "border-line-2"
        }`}
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} className="text-[0.8125rem] text-amber-deep">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[0.8125rem] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  name,
  id: idProp,
  error,
  children,
  defaultValue,
  required,
  hint,
}: {
  label: string;
  name: string;
  /** Defaults to `name`; pass one when two forms on a page share a name. */
  id?: string;
  error?: string;
  children: ReactNode;
  defaultValue?: string;
  required?: boolean;
  hint?: ReactNode;
}) {
  const id = idProp ?? name;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-semibold text-ink-2">
        {label}
      </label>
      {/*
        Keyed on the default so a rejected submit shows what was chosen. React
        resets the form when an action returns and re-applies a text input's
        new `defaultValue`, but it never re-applies a changed `defaultValue`
        on a <select>, which would snap back to the first option on top of
        the error message. A new key remounts it with the right choice.
      */}
      <select
        key={defaultValue ?? ""}
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-[var(--radius)] border bg-paper px-3 py-2.5 text-[0.9375rem] text-ink ${
          error ? "border-amber-deep" : "border-line-2"
        }`}
      >
        {children}
      </select>
      {error ? (
        <p id={`${id}-error`} className="text-[0.8125rem] text-amber-deep">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[0.8125rem] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A single checkbox with its wording beside it.
 *
 * The label is the whole sentence, not a word next to a box — the one place
 * this is used is a consent tick, where what somebody agreed to has to be the
 * thing they clicked on, and has to be legible on a phone. `defaultChecked` is
 * a prop rather than a default so a rejected submit can put back what the
 * person actually ticked; nothing here should ever start out ticked.
 */
export function Checkbox({
  name,
  error,
  defaultChecked,
  required,
  children,
}: {
  name: string;
  error?: string;
  defaultChecked?: boolean;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={name}
        className="flex cursor-pointer items-start gap-2.5 text-[0.875rem] leading-relaxed text-ink-2"
      >
        <input
          id={name}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${name}-error` : undefined}
          // mt-1 rather than items-center: the wording runs to three lines on a
          // phone and a centred box floats away from its first line.
          className={`mt-1 h-4 w-4 flex-none accent-[var(--emerald-deep)] ${
            error ? "outline outline-1 outline-amber-deep" : ""
          }`}
        />
        <span>{children}</span>
      </label>
      {error && (
        <p id={`${name}-error`} className="text-[0.8125rem] text-amber-deep">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Submit button wired to the form's own pending state.
 *
 * `useFormStatus` reads the enclosing form, so this disables itself while the
 * action runs without any of the screens tracking that. Sign-in deliberately
 * costs a couple of hundred milliseconds of hashing; a second click during
 * that window would otherwise burn one of the ten attempts.
 */
export function Submit({
  children,
  pendingLabel,
  className = "btn btn-emerald w-full",
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  /**
   * A name/value pair the action sees only when this button was what
   * submitted the form — a `requestSubmit()` from a select carries no
   * submitter, so the pair is absent. It is how one form can tell "the person
   * pressed Save" from "a control saved itself".
   */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

/** Form-level error: wrong password, expired invite, database down. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-[var(--radius)] border border-amber-line bg-amber-wash px-3 py-2.5 text-[0.875rem] text-amber-deep"
    >
      {children}
    </p>
  );
}
