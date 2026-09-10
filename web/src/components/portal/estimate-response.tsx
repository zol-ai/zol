"use client";

import { useActionState, useState } from "react";

import { respondToEstimate } from "@/app/actions/portal";
import type { FormState } from "@/app/actions/auth";
import { FormError, Submit } from "@/components/app/field";
import { formatCents } from "@/lib/money";
import { MoneyRow } from "./ui";

export interface PortalEstimateLine {
  id: string;
  description: string;
  kindLabel: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
  /** Parts and fees carry tax; labour doesn't. Decided on the server. */
  taxable: boolean;
}

/**
 * The customer's answer, one line at a time, with the total moving as they
 * decide.
 *
 * Every line starts as Approve: the shop is recommending all of it, and the
 * common case is "yes to everything" in one tap. Declining is one tap more.
 *
 * The running total here is a preview. It repeats the arithmetic in
 * lib/ro-totals.ts (`totalsFor`, which is server-only and can't run in the
 * browser); the server recomputes from the lines before writing anything,
 * so a browser that disagreed could only ever mislead itself.
 */
export function EstimateResponse({
  token,
  estimateId,
  number,
  taxRatePct,
  lines,
}: {
  token: string;
  estimateId: string;
  number: number;
  taxRatePct: number;
  lines: PortalEstimateLine[];
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    respondToEstimate,
    undefined,
  );
  const [decisions, setDecisions] = useState<Record<string, "approved" | "declined">>(() =>
    Object.fromEntries(lines.map((line) => [line.id, "approved" as const])),
  );

  const approved = lines.filter((line) => decisions[line.id] !== "declined");
  const subtotal = approved.reduce((sum, line) => sum + line.totalCents, 0);
  const taxable = approved.filter((line) => line.taxable).reduce((sum, line) => sum + line.totalCents, 0);
  const tax = Math.round((taxable * taxRatePct) / 100);
  const total = subtotal + tax;
  const declinedCount = lines.length - approved.length;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="estimate_id" value={estimateId} />
      <FormError>{state?.error}</FormError>

      <ul className="divide-y divide-line border-y border-line">
        {lines.map((line) => {
          const decision = decisions[line.id] ?? "approved";
          const name = `line:${line.id}`;
          return (
            <li key={line.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-[0.9375rem] ${decision === "declined" ? "text-ink-3 line-through" : "text-ink"}`}>
                    {line.description}
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] text-ink-3">
                    {line.kindLabel}
                    {" · "}
                    <span className="t-data">
                      {line.quantity} × {formatCents(line.unitCents)}
                    </span>
                  </p>
                </div>
                <span className={`t-data flex-none text-[0.9375rem] ${decision === "declined" ? "text-ink-3 line-through" : "text-ink"}`}>
                  {formatCents(line.totalCents)}
                </span>
              </div>

              {/*
                Two radios drawn as a segmented switch. Real radios underneath
                so the form posts without JavaScript and screen readers get a
                proper group; the label is the whole tappable chip.
              */}
              <fieldset className="mt-2 grid grid-cols-2 gap-1.5">
                <legend className="sr-only">{line.description}: approve or decline</legend>
                <Choice
                  name={name}
                  value="approved"
                  checked={decision === "approved"}
                  onChange={() => setDecisions((prev) => ({ ...prev, [line.id]: "approved" }))}
                  activeClass="border-emerald-deep bg-emerald-wash text-emerald-deep"
                >
                  Approve
                </Choice>
                <Choice
                  name={name}
                  value="declined"
                  checked={decision === "declined"}
                  onChange={() => setDecisions((prev) => ({ ...prev, [line.id]: "declined" }))}
                  activeClass="border-ink bg-paper-3 text-ink"
                >
                  Not now
                </Choice>
              </fieldset>
            </li>
          );
        })}
      </ul>

      <dl className="flex flex-col gap-1.5">
        <MoneyRow label="Approved work" value={formatCents(subtotal)} />
        <MoneyRow label={`Tax (${taxRatePct}% on parts and fees)`} value={formatCents(tax)} />
        <MoneyRow label="Your total" value={formatCents(total)} strong />
      </dl>

      <Submit className="btn btn-emerald w-full" pendingLabel="Sending your answer…">
        {declinedCount === 0
          ? `Approve everything — ${formatCents(total)}`
          : approved.length === 0
            ? "Decline this estimate"
            : `Approve ${approved.length} of ${lines.length} — ${formatCents(total)}`}
      </Submit>
      <p className="text-center text-[0.8125rem] leading-relaxed text-ink-3">
        Estimate #{number}. Approving tells the shop to go ahead with the work you&apos;ve
        chosen at the prices shown. Anything you decline is noted, not forgotten — they can
        do it another time.
      </p>
    </form>
  );
}

function Choice({
  name,
  value,
  checked,
  onChange,
  activeClass,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  activeClass: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-[var(--radius)] border px-3 text-[0.875rem] font-semibold transition-colors ${
        checked ? activeClass : "border-line-2 bg-paper text-ink-2"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {children}
    </label>
  );
}
