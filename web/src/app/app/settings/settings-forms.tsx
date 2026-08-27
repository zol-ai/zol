"use client";

import { useActionState } from "react";

import { changePassword, type FormState } from "@/app/actions/auth";
import { saveHours, saveShop } from "@/app/actions/shop";
import { Field, FormError, Submit } from "@/components/app/field";

export interface ShopSettings {
  name: string;
  timezone: string;
  bay_count: number;
  labor_rate_cents: number;
  parts_margin_pct: string;
  tax_rate_pct: string;
  auto_quote_cap_cents: number;
}

export interface DayHours {
  day_of_week: number;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean;
}

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Cents in the column, dollars in the box — nobody types 14500 for a labour rate. */
function dollars(value: number): string {
  return (value / 100).toFixed(2);
}

export function ShopForm({ shop }: { shop: ShopSettings }) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    saveShop,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError>{state?.error}</FormError>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Shop name"
          name="name"
          required
          defaultValue={shop.name}
          error={state?.fields?.name}
        />
        <Field
          label="Time zone"
          name="timezone"
          required
          defaultValue={shop.timezone}
          error={state?.fields?.timezone}
          hint="IANA name, e.g. America/Los_Angeles."
        />
        <Field
          label="Bays"
          name="bay_count"
          type="number"
          min={1}
          max={60}
          required
          defaultValue={shop.bay_count}
          error={state?.fields?.bay_count}
        />
        <Field
          label="Labour rate"
          name="labor_rate"
          inputMode="decimal"
          required
          defaultValue={dollars(shop.labor_rate_cents)}
          error={state?.fields?.labor_rate}
          hint="Per hour. What book hours are multiplied by."
        />
        <Field
          label="Parts margin"
          name="parts_margin_pct"
          inputMode="decimal"
          required
          defaultValue={shop.parts_margin_pct}
          error={state?.fields?.parts_margin_pct}
          hint="Percent added to your cost."
        />
        <Field
          label="Tax rate"
          name="tax_rate_pct"
          inputMode="decimal"
          required
          defaultValue={shop.tax_rate_pct}
          error={state?.fields?.tax_rate_pct}
          hint="Percent. Leave 0 if you add it later."
        />
      </div>

      <Field
        label="Quote without asking, up to"
        name="auto_quote_cap"
        inputMode="decimal"
        required
        defaultValue={dollars(shop.auto_quote_cap_cents)}
        error={state?.fields?.auto_quote_cap}
        hint="Above this, ZOL stops and one of your people approves the number before the customer hears it."
      />

      <Submit className="btn btn-emerald self-start">Save</Submit>
    </form>
  );
}

export function HoursForm({ hours }: { hours: DayHours[] }) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    saveHours,
    undefined,
  );

  const byDay = new Map(hours.map((h) => [h.day_of_week, h]));

  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError>{state?.error}</FormError>

      {DAYS.map((label, day) => {
        const row = byDay.get(day);
        const error = state?.fields?.[`opens_${day}`];
        return (
          <div key={day} className="flex flex-wrap items-center gap-3 border-b border-line pb-3 last:border-0">
            <span className="w-24 flex-none text-[0.9375rem] font-semibold text-ink">
              {label}
            </span>

            <label className="flex items-center gap-2 text-[0.875rem] text-ink-2">
              <input
                type="checkbox"
                name={`closed_${day}`}
                defaultChecked={row?.is_closed ?? (day === 0 || day === 6)}
                className="h-4 w-4 accent-[var(--emerald-deep)]"
              />
              Closed
            </label>

            {/* The two clocks drop to their own line on a phone rather than
                wrapping between "to" and the closing time. */}
            <div className="flex w-full items-center gap-3 sm:w-auto">
              <input
                type="time"
                name={`opens_${day}`}
                aria-label={`${label} opening time`}
                defaultValue={row?.opens_at?.slice(0, 5) ?? "08:00"}
                className="t-data rounded-[var(--radius)] border border-line-2 bg-paper px-2 py-1.5 text-[0.875rem]"
              />
              <span className="text-ink-3">to</span>
              <input
                type="time"
                name={`closes_${day}`}
                aria-label={`${label} closing time`}
                defaultValue={row?.closes_at?.slice(0, 5) ?? "17:00"}
                className="t-data rounded-[var(--radius)] border border-line-2 bg-paper px-2 py-1.5 text-[0.875rem]"
              />
            </div>

            {error && (
              <span className="w-full text-[0.8125rem] text-amber-deep">
                {error}
              </span>
            )}
          </div>
        );
      })}

      <Submit className="btn btn-emerald self-start">Save hours</Submit>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    changePassword,
    undefined,
  );

  return (
    <form action={action} className="flex max-w-sm flex-col gap-4">
      <FormError>{state?.error}</FormError>

      <Field
        label="Current password"
        name="current_password"
        type="password"
        autoComplete="current-password"
        required
        error={state?.fields?.current_password}
      />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        error={state?.fields?.password}
        hint="At least 10 characters. Signs you out everywhere else."
      />

      <Submit className="btn btn-ghost self-start">Change password</Submit>
    </form>
  );
}
