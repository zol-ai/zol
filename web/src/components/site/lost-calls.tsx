"use client";

import { useId, useState } from "react";
import { DemoButton } from "./demo-button";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type FieldProps = {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (n: number) => void;
};

/**
 * Three of these sit side by side. Each one spans all three rows of the parent
 * grid and inherits its row track, so the rails and the hints line up across
 * the columns even when one label wraps and another doesn't.
 */
function Field({ label, hint, min, max, step, value, display, onChange }: FieldProps) {
  const id = useId();
  return (
    <div className="sm:row-span-3 sm:grid sm:grid-rows-subgrid sm:gap-0">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="t-eyebrow text-[0.625rem]">
          {label}
        </label>
        <output htmlFor={id} className="t-data text-[0.9375rem] font-semibold text-ink">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="scan-range mt-3 w-full self-end"
      />
      <p className="mt-2 text-[0.75rem] leading-snug text-ink-3">{hint}</p>
    </div>
  );
}

/**
 * Arithmetic, not a claim. We have no idea what a missed call is worth at
 * someone else's shop, so the owner supplies all three numbers and the panel
 * only multiplies them.
 */
export function LostCalls() {
  const [missed, setMissed] = useState(12);
  const [closeRate, setCloseRate] = useState(40);
  const [ticket, setTicket] = useState(420);

  const annual = Math.round(missed * 52 * (closeRate / 100) * ticket);

  return (
    <div className="card overflow-hidden">
      <div className="grid lg:grid-cols-[1.25fr_0.75fr]">
        <div className="p-6 sm:p-8">
          <p className="t-eyebrow">Your numbers</p>
          <h3 className="t-h3 mt-3 text-[1.375rem]">
            What the missed ones are worth
          </h3>

          <div className="mt-7 grid gap-6 sm:grid-cols-3 sm:grid-rows-[auto_auto_1fr] sm:gap-y-0">
            <Field
              label="Calls missed / week"
              hint="After hours, or nobody free to grab it."
              min={0}
              max={60}
              step={1}
              value={missed}
              display={String(missed)}
              onChange={setMissed}
            />
            <Field
              label="Would have booked"
              hint="Callers with real work to sell."
              min={5}
              max={90}
              step={5}
              value={closeRate}
              display={`${closeRate}%`}
              onChange={setCloseRate}
            />
            <Field
              label="Average ticket"
              hint="Parts and labor together."
              min={80}
              max={2000}
              step={20}
              value={ticket}
              display={money.format(ticket)}
              onChange={setTicket}
            />
          </div>
        </div>

        <div className="flex flex-col justify-center border-t border-line bg-paper-3 p-6 sm:p-8 lg:border-l lg:border-t-0">
          <p className="t-eyebrow text-[0.625rem]">Walking out the door each year</p>
          <p className="t-num mt-3 text-[2.5rem] text-emerald-deep sm:text-[3rem]">
            {money.format(annual)}
          </p>
          <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-3">
            {missed} × 52 × {closeRate}% × {money.format(ticket)}. Your
            arithmetic, not our claim.
          </p>
          <DemoButton variant="emerald" size="sm" className="mt-5 self-start">
            See it on your own numbers
          </DemoButton>
        </div>
      </div>
    </div>
  );
}
