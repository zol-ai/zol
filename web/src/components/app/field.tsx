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

export function Field({ label, name, error, hint, ...input }: FieldProps) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={name}
        className="text-[0.8125rem] font-semibold text-ink-2"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-[var(--radius)] border bg-paper px-3 py-2.5 text-[0.9375rem] text-ink placeholder:text-ink-3/70 ${
          error ? "border-amber-deep" : "border-line-2"
        }`}
        {...input}
      />
      {error ? (
        <p id={`${name}-error`} className="text-[0.8125rem] text-amber-deep">
          {error}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="text-[0.8125rem] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  name,
  error,
  children,
  defaultValue,
}: {
  label: string;
  name: string;
  error?: string;
  children: ReactNode;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-[0.8125rem] font-semibold text-ink-2">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        className={`w-full rounded-[var(--radius)] border bg-paper px-3 py-2.5 text-[0.9375rem] text-ink ${
          error ? "border-amber-deep" : "border-line-2"
        }`}
      >
        {children}
      </select>
      {error && <p className="text-[0.8125rem] text-amber-deep">{error}</p>}
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
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
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
