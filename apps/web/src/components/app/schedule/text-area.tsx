"use client";

import type { ReactNode, TextareaHTMLAttributes } from "react";

/**
 * The multi-line sibling of `Field` (components/app/field.tsx), styled the
 * same so a complaint box sits next to a date box without looking borrowed.
 * Lives with the schedule forms because that is where free text first needed
 * a label and an error of its own.
 */
export function TextArea({
  label,
  name,
  error,
  hint,
  rows = 3,
  ...input
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
}) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-[0.8125rem] font-semibold text-ink-2">
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={rows}
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
