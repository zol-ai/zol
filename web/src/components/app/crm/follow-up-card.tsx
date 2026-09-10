"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { FormState } from "@/app/actions/auth";
import {
  cancelFollowUp,
  generateFollowUpDraft,
  markFollowUpDone,
  saveFollowUpBody,
  sendFollowUpNow,
  applyFollowUpDraft,
} from "@/app/actions/follow-ups";
import { FormError, Submit } from "@/components/app/field";
import { StatusBadge, Tag } from "@/components/app/ui";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { RETENTION_KINDS, type FollowUpKind } from "@/lib/statuses";

/**
 * One follow-up, as the CRM, a customer's page and a vehicle's page show it.
 *
 * The card is the worklist item: who, what, why, the words that will go out,
 * and the buttons. Every button is a form posting to a Server Action, so the
 * card works from a phone in the bay with a flaky connection and nothing here
 * holds state a reload would lose. The one piece of client state is the
 * body editor, which needs `useActionState` to show a validation message
 * inline instead of bouncing the person to another page.
 */

export interface FollowUpCardData {
  id: string;
  kind: string;
  status: string;
  title: string | null;
  details: string | null;
  body: string | null;
  ai_draft: string | null;
  /** Who wrote the draft: the model, or the template. Null before any draft. */
  ai_source: "openai" | "fallback" | null;
  channel: string;
  source: string;
  scheduled_for: string;
  /** Pending and past its time, as the database saw it when the page rendered. */
  due: boolean;
  sent_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  attempts: number;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string;
  sms_opted_out: boolean;
  preferred_contact: string;
  vehicle_id: string | null;
  vehicle: string | null;
  repair_order_id: string | null;
  ro_number: number | null;
  declined_work_id: string | null;
  /** Channel of the message the worker actually wrote, once sent. */
  sent_via: string | null;
  completed_by_name: string | null;
}

const PREFERS: Record<string, string> = {
  sms: "prefers text",
  email: "prefers email",
  phone: "prefers a call",
};

export function FollowUpCard({
  followUp: f,
  timezone,
  returnTo,
  aiConfigured,
  showCustomer = true,
}: {
  followUp: FollowUpCardData;
  timezone: string;
  /** Path the buttons land back on. */
  returnTo: string;
  /** Whether "Draft with AI" reaches a model or the built-in template. */
  aiConfigured: boolean;
  /** Off on the customer's own page, where the name is the heading. */
  showCustomer?: boolean;
}) {
  const pending = f.status === "pending";
  const due = pending && f.due;

  const hidden = (
    <>
      <input type="hidden" name="id" value={f.id} />
      <input type="hidden" name="return_to" value={returnTo} />
    </>
  );

  return (
    <li id={`fu-${f.id}`} className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="followUpKind" value={f.kind} />
        {pending ? (
          due ? (
            <Tag tone="person">Due now</Tag>
          ) : (
            <Tag tone="neutral">Scheduled</Tag>
          )
        ) : (
          <StatusBadge kind="followUp" value={f.status} />
        )}
        {/*
          A journey message carries the actor of the button that moved the
          ticket, so "person" there just means a person pressed it. Only a
          retention follow-up somebody queued deliberately is worth a tag.
        */}
        {f.source === "person" && RETENTION_KINDS.includes(f.kind as FollowUpKind) && (
          <Tag tone="neutral">Queued by hand</Tag>
        )}
        {f.sms_opted_out && <Tag tone="person">Texts stopped — call them</Tag>}
        {/*
          Absolute times throughout, not "3 min ago": this is a client
          component, and a relative label read off the clock would be computed
          once on the server and again at hydration against a different time,
          which React reports as a text mismatch.
        */}
        <span className="t-data ml-auto text-[0.75rem] text-ink-3">
          {pending
            ? `${due ? "was due" : "due"} ${formatDateTime(f.scheduled_for, timezone)}`
            : f.status === "sent" && f.sent_at
              ? `sent ${formatDateTime(f.sent_at, timezone)}${f.sent_via ? ` via ${f.sent_via === "portal" ? "portal" : f.sent_via === "sms" ? "text" : f.sent_via}` : ""}`
              : f.completed_at
                ? `${f.status} ${formatDateTime(f.completed_at, timezone)}${f.completed_by_name ? ` by ${f.completed_by_name}` : ""}`
                : formatDateTime(f.scheduled_for, timezone)}
        </span>
      </div>

      <p className="mt-2 text-[0.9375rem] font-semibold text-ink">
        {f.title ?? "Follow-up"}
      </p>
      {f.details && (
        <p className="mt-0.5 text-[0.875rem] leading-relaxed text-ink-2">{f.details}</p>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ink-2">
        {showCustomer && (
          <>
            <Link
              href={`/app/customers/${f.customer_id}`}
              className="font-semibold text-ink underline-offset-2 hover:underline"
            >
              {f.customer_name ?? "Unnamed"}
            </Link>
            <a href={`tel:${f.customer_phone}`} className="t-data">
              {formatPhone(f.customer_phone)}
            </a>
            {PREFERS[f.preferred_contact] && f.preferred_contact !== "sms" && (
              <span className="text-ink-3">· {PREFERS[f.preferred_contact]}</span>
            )}
          </>
        )}
        {f.vehicle && f.vehicle_id && (
          <>
            {showCustomer && <span className="text-ink-3">·</span>}
            <Link href={`/app/vehicles/${f.vehicle_id}`} className="underline-offset-2 hover:underline">
              {f.vehicle}
            </Link>
          </>
        )}
        {f.repair_order_id && f.ro_number && (
          <>
            <span className="text-ink-3">·</span>
            <Link
              href={`/app/repair-orders/${f.repair_order_id}`}
              className="t-data underline-offset-2 hover:underline"
            >
              #{f.ro_number}
            </Link>
          </>
        )}
      </p>

      {/* What the customer gets. Mono, because it is the literal text. */}
      {f.body ? (
        <p className="t-data mt-3 whitespace-pre-wrap rounded-[var(--radius)] bg-paper-3 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink">
          {f.body}
        </p>
      ) : (
        pending && (
          <p className="mt-3 rounded-[var(--radius)] border border-dashed border-line-2 px-3 py-2.5 text-[0.8125rem] text-ink-3">
            No message yet. Draft one, or write it below.
          </p>
        )
      )}

      {pending && f.ai_draft && f.ai_draft !== f.body && (
        <div className="mt-3 rounded-[var(--radius)] border border-emerald-line bg-emerald-wash p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.75rem] font-semibold uppercase tracking-wider text-emerald-deep">
              {f.ai_source === "openai"
                ? "Draft from ZOL"
                : f.ai_source === "fallback"
                  ? "Template draft — written without a model"
                  : aiConfigured
                    ? "Draft from ZOL"
                    : "Template draft — no AI key configured"}
            </p>
            <form action={applyFollowUpDraft}>
              {hidden}
              <button type="submit" className="btn btn-emerald btn-sm">
                Use draft
              </button>
            </form>
          </div>
          <p className="t-data mt-2 whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-ink">
            {f.ai_draft}
          </p>
        </div>
      )}

      {f.last_error && (
        <p className="mt-3 text-[0.8125rem] text-red-deep">
          {f.status === "failed" ? "Gave up" : f.status === "cancelled" ? "Not sent" : "Last try failed"}
          {": "}
          {f.last_error}
          {f.attempts > 0 && ` · ${f.attempts} ${f.attempts === 1 ? "attempt" : "attempts"}`}
        </p>
      )}

      {pending && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <form action={generateFollowUpDraft}>
            {hidden}
            <button type="submit" className="btn btn-ghost btn-sm">
              {f.ai_draft ? "Redraft" : "Draft with AI"}
            </button>
          </form>

          <BodyEditor followUp={f} returnTo={returnTo} />

          {!f.sms_opted_out && f.body && (
            <form action={sendFollowUpNow}>
              {hidden}
              <button type="submit" className="btn btn-emerald btn-sm">
                Send now
              </button>
            </form>
          )}

          <form action={markFollowUpDone}>
            {hidden}
            <button type="submit" className="btn btn-ghost btn-sm">
              Mark done
            </button>
          </form>

          <form action={cancelFollowUp} className="ml-auto">
            {hidden}
            <button
              type="submit"
              className="text-[0.8125rem] text-ink-3 underline-offset-2 hover:underline"
            >
              Cancel
            </button>
          </form>
        </div>
      )}
    </li>
  );
}

/** Edit the words inline. A <details> so the card stays short until it's needed. */
function BodyEditor({
  followUp: f,
  returnTo,
}: {
  followUp: FollowUpCardData;
  returnTo: string;
}) {
  const [state, action] = useActionState<FormState | undefined, FormData>(
    saveFollowUpBody,
    undefined,
  );

  return (
    <details className="group basis-full sm:basis-auto">
      <summary className="btn btn-ghost btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {f.body ? "Edit" : "Write it"}
      </summary>
      <form action={action} className="mt-3 flex flex-col gap-2">
        <FormError>{state?.error}</FormError>
        <input type="hidden" name="id" value={f.id} />
        <input type="hidden" name="return_to" value={returnTo} />
        <label htmlFor={`body-${f.id}`} className="sr-only">
          Message
        </label>
        <textarea
          id={`body-${f.id}`}
          name="body"
          rows={4}
          maxLength={480}
          required
          defaultValue={state?.values?.body ?? f.body ?? f.ai_draft ?? ""}
          aria-invalid={state?.fields?.body ? true : undefined}
          className={`input t-data text-[0.8125rem] leading-relaxed ${
            state?.fields?.body ? "border-amber-deep" : ""
          }`}
        />
        {state?.fields?.body && (
          <p className="text-[0.8125rem] text-amber-deep">{state.fields.body}</p>
        )}
        <div className="flex items-center gap-2">
          <Submit className="btn btn-primary btn-sm" pendingLabel="Saving…">
            Save message
          </Submit>
          <span className="text-[0.75rem] text-ink-3">Opens with the shop name; keep it short.</span>
        </div>
      </form>
    </details>
  );
}
