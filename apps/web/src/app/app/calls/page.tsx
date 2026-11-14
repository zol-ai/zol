import Link from "next/link";
import { CalendarCheck, PhoneCall, Timer } from "lucide-react";

import { runTestCall } from "@/app/actions/calls";
import { PageHead } from "@/components/app/shell";
import { EmptyState, MetricCard, Section, StatusBadge, Tag } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { TEST_CALL_SCRIPTS } from "@/lib/receptionist/scripts";

export const metadata = { title: "Calls" };

interface CallRow {
  id: string;
  caller_name: string | null;
  from_number: string;
  customer_id: string | null;
  customer_name: string | null;
  vehicle: string | null;
  complaint: string | null;
  urgency: string | null;
  outcome: string | null;
  status: string;
  started_at: string;
  duration_seconds: number | null;
  simulated: boolean;
  escalation_required: boolean;
  appointment_id: string | null;
  appointment_at: string | null;
}

interface ConversationRow {
  id: string;
  channel: string;
  status: string;
  phone: string | null;
  summary: string | null;
  complaint: string | null;
  customer_id: string | null;
  customer_name: string | null;
  created_at: string;
  appointment_at: string | null;
}

/** "2 min 23 s", or "43 s". */
function duration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

export default async function CallsPage() {
  const user = await requireUser();

  const [metrics, calls, conversations] = await Promise.all([
    /*
      "This week" in the shop's zone: `now() AT TIME ZONE tz` is the shop's
      wall clock, date_trunc walks it back to Monday, and the second
      AT TIME ZONE turns that back into the instant the week began there.
      Test calls are counted separately so the rates stay honest.
    */
    query<{ real: string; sim: string; booked: string; avg_secs: string | null }>(
      `SELECT count(*) FILTER (WHERE NOT simulated) AS real,
              count(*) FILTER (WHERE simulated) AS sim,
              count(*) FILTER (WHERE NOT simulated AND outcome = 'booked') AS booked,
              avg(duration_seconds) FILTER (WHERE NOT simulated) AS avg_secs
         FROM calls
        WHERE shop_id = $1
          AND started_at >= (date_trunc('week', now() AT TIME ZONE $2) AT TIME ZONE $2)`,
      [user.shopId, user.timezone],
    ),
    query<CallRow>(
      `SELECT k.id, k.caller_name, k.from_number, k.customer_id, c.full_name AS customer_name,
              nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
              k.intake->>'complaint' AS complaint, k.intake->>'urgency' AS urgency,
              k.outcome, k.status, k.started_at::text, k.duration_seconds,
              k.simulated, k.escalation_required,
              a.id AS appointment_id, a.starts_at::text AS appointment_at
         FROM calls k
         LEFT JOIN customers c ON c.id = k.customer_id
         LEFT JOIN vehicles v ON v.id = k.vehicle_id
         LEFT JOIN appointments a ON a.id = k.appointment_id
        WHERE k.shop_id = $1
        ORDER BY k.started_at DESC
        LIMIT 50`,
      [user.shopId],
    ),
    query<ConversationRow>(
      `SELECT cv.id, cv.channel, cv.status, cv.phone, cv.summary,
              cv.intake->>'complaint' AS complaint,
              cv.customer_id, c.full_name AS customer_name,
              cv.created_at::text, a.starts_at::text AS appointment_at
         FROM conversations cv
         LEFT JOIN customers c ON c.id = cv.customer_id
         LEFT JOIN appointments a ON a.id = cv.appointment_id
        WHERE cv.shop_id = $1 AND cv.channel <> 'voice'
        ORDER BY cv.created_at DESC
        LIMIT 20`,
      [user.shopId],
    ),
  ]);

  const m = metrics[0];
  const real = Number(m?.real ?? 0);
  const sim = Number(m?.sim ?? 0);
  const booked = Number(m?.booked ?? 0);
  const avg = m?.avg_secs ? Math.round(Number(m.avg_secs)) : null;

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Calls"
        description="Every call ZOL answered, what it took down, and what it booked. Phone lines are switched off until carrier registration clears; test calls run the same pipeline."
      >
        <form action={runTestCall} className="flex flex-wrap gap-2">
          {TEST_CALL_SCRIPTS.map((script, index) => (
            <button
              key={script.key}
              type="submit"
              name="script"
              value={script.key}
              className={`btn btn-sm ${index === 0 ? "btn-emerald" : "btn-ghost"}`}
              title={script.detail}
            >
              Run a test call: {script.title.toLowerCase()}
            </button>
          ))}
        </form>
      </PageHead>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Calls this week"
          value={real}
          icon={PhoneCall}
          tone="neutral"
          detail={sim > 0 ? `+${sim} test` : undefined}
        />
        <MetricCard
          label="Booked"
          value={real > 0 ? `${booked} · ${Math.round((booked / real) * 100)}%` : booked}
          icon={CalendarCheck}
          tone="zol"
          detail="real calls only"
        />
        <MetricCard
          label="Average length"
          value={avg == null ? "—" : duration(avg)}
          icon={Timer}
          tone="blue"
          detail="real calls only"
        />
      </div>

      <Section
        title="Recent calls"
        detail={`${calls.length === 50 ? "The last 50" : calls.length} answered by ZOL. Newest first.`}
        flush
      >
        {calls.length === 0 ? (
          <EmptyState
            title="No calls yet"
            detail="When the line is live, every call ZOL answers lands here with its transcript, what it took down and what it booked. Run a test call to see one now."
          />
        ) : (
          <ul className="divide-y divide-line">
            {calls.map((call) => {
              const who = call.customer_name ?? call.caller_name ?? formatPhone(call.from_number);
              return (
                <li key={call.id}>
                  <Link
                    href={`/app/calls/${call.id}`}
                    className="grid gap-x-4 gap-y-1.5 px-4 py-3.5 transition-colors hover:bg-paper-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_auto] sm:items-center sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold text-ink">
                        <span className="truncate">{who}</span>
                        {call.simulated && <Tag tone="neutral">Test</Tag>}
                        {call.escalation_required && <Tag tone="person">Needs a person</Tag>}
                      </p>
                      <p className="t-data mt-0.5 text-[0.75rem] text-ink-3">
                        {formatPhone(call.from_number)} · {duration(call.duration_seconds)}
                      </p>
                    </div>

                    <div className="min-w-0 text-[0.875rem] text-ink-2">
                      {call.vehicle && <span className="font-semibold text-ink">{call.vehicle}</span>}
                      {call.vehicle && call.complaint && " — "}
                      <span className="line-clamp-2">{call.complaint ?? (call.vehicle ? "" : "No intake recorded")}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-end">
                      <StatusBadge kind="callOutcome" value={call.outcome ?? call.status} />
                      <span className="text-[0.75rem] text-ink-3">
                        {call.appointment_at
                          ? `Booked ${formatDateTime(call.appointment_at, user.timezone)}`
                          : "No appointment"}
                      </span>
                      <span className="t-data text-[0.75rem] text-ink-3">
                        {formatRelative(call.started_at, user.timezone)}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="mt-6" id="conversations">
        <Section
          title="Web & text conversations"
          detail="The same receptionist, on the shop's chat page and — once texting is on — by SMS. Bookings from here show on the schedule as ZOL booked."
          flush
        >
          {conversations.length === 0 ? (
            <EmptyState
              title="No chats yet"
              detail="Customers reach ZOL on the shop's public chat page. Anything that books, escalates or asks a question shows up here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {conversations.map((cv) => {
                const who = cv.customer_name ?? (cv.phone ? formatPhone(cv.phone) : "Web visitor");
                return (
                  <li
                    key={cv.id}
                    className="grid gap-x-4 gap-y-1.5 px-4 py-3.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_auto] sm:items-center sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold text-ink">
                        {cv.customer_id ? (
                          <Link href={`/app/customers/${cv.customer_id}`} className="truncate underline-offset-4 hover:underline">
                            {who}
                          </Link>
                        ) : (
                          <span className="truncate">{who}</span>
                        )}
                        <Tag tone={cv.channel === "sms" ? "blue" : "neutral"}>{cv.channel === "sms" ? "Text" : "Web chat"}</Tag>
                      </p>
                      <p className="t-data mt-0.5 text-[0.75rem] text-ink-3">
                        {formatRelative(cv.created_at, user.timezone)}
                      </p>
                    </div>
                    <p className="min-w-0 text-[0.875rem] text-ink-2">
                      <span className="line-clamp-2">{cv.summary ?? cv.complaint ?? "Still talking."}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-end">
                      <StatusBadge kind="conversation" value={cv.status} />
                      <span className="text-[0.75rem] text-ink-3">
                        {cv.appointment_at ? `Booked ${formatDateTime(cv.appointment_at, user.timezone)}` : "No appointment"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
