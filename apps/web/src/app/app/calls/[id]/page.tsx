import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHead } from "@/components/app/shell";
import { Facts, Notice, Section, StatusBadge, Tag, Timeline, type TimelineItem } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatTime, formatWhen } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { Intake } from "@/lib/receptionist/intake";
import { zonedDate } from "@/lib/schedule";
import { FOLLOW_UP_KIND_LABEL, FOLLOW_UP_STATUS_LABEL, type FollowUpKind, type FollowUpStatus } from "@/lib/statuses";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What's in `calls.intake` — full for anything ZOL wrote, partial for older rows. */
type StoredIntake = Partial<Omit<Intake, "vehicle">> & { vehicle?: Partial<Intake["vehicle"]> | null };

interface CallRecord {
  id: string;
  caller_name: string | null;
  from_number: string;
  to_number: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  status: string;
  summary: string | null;
  intake: StoredIntake | null;
  transcript: { role: string; content: string }[] | null;
  recording_url: string | null;
  sentiment: string | null;
  escalation_required: boolean;
  simulated: boolean;
  handled_by: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  sms_opted_out: boolean | null;
  vehicle_id: string | null;
  vehicle: string | null;
  appointment_id: string | null;
  conversation_id: string | null;
  intake_source: string | null;
}

function duration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

export async function generateMetadata(props: PageProps<"/app/calls/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Call" };
  const rows = await query<{ caller_name: string | null; full_name: string | null }>(
    `SELECT k.caller_name, c.full_name FROM calls k LEFT JOIN customers c ON c.id = k.customer_id
      WHERE k.id = $1 AND k.shop_id = $2`,
    [id, user.shopId],
  );
  const name = rows[0]?.full_name ?? rows[0]?.caller_name;
  return { title: name ? `Call · ${name}` : "Call" };
}

export default async function CallPage(props: PageProps<"/app/calls/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  // shop_id in the WHERE, not just the id: the id is a uuid from the URL.
  const calls = await query<CallRecord>(
    `SELECT k.id, k.caller_name, k.from_number, k.to_number, k.started_at::text, k.ended_at::text,
            k.duration_seconds, k.outcome, k.status, k.summary, k.intake, k.transcript,
            k.recording_url, k.sentiment, k.escalation_required, k.simulated, k.handled_by,
            k.customer_id, c.full_name AS customer_name, c.phone AS customer_phone, c.sms_opted_out,
            k.vehicle_id, nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
            k.appointment_id, k.conversation_id, cv.intake_source
       FROM calls k
       LEFT JOIN customers c ON c.id = k.customer_id
       LEFT JOIN vehicles v ON v.id = k.vehicle_id
       LEFT JOIN conversations cv ON cv.id = k.conversation_id
      WHERE k.id = $1 AND k.shop_id = $2`,
    [id, user.shopId],
  );
  const call = calls[0];
  if (!call) notFound();

  const [lines, appointments, openedTickets, followUps, messages] = await Promise.all([
    call.conversation_id
      ? query<{ id: string; role: string; content: string; created_at: string }>(
          `SELECT id, role, content, created_at::text FROM conversation_messages
            WHERE conversation_id = $1 ORDER BY created_at, id`,
          [call.conversation_id],
        )
      : Promise.resolve([]),
    call.appointment_id
      ? query<{
          id: string;
          starts_at: string;
          ends_at: string;
          bay: number | null;
          status: string;
          service_type: string | null;
          repair_order_id: string | null;
          ro_number: number | null;
          technician_name: string | null;
        }>(
          `SELECT a.id, a.starts_at::text, a.ends_at::text, a.bay, a.status, a.service_type,
                  a.repair_order_id, ro.number AS ro_number, t.full_name AS technician_name
             FROM appointments a
             LEFT JOIN repair_orders ro ON ro.id = a.repair_order_id
             LEFT JOIN staff t ON t.id = a.technician_id
            WHERE a.id = $1 AND a.shop_id = $2`,
          [call.appointment_id, user.shopId],
        )
      : Promise.resolve([]),
    query<{ id: string; number: number; status: string }>(
      `SELECT id, number, status FROM repair_orders
        WHERE opened_by_call_id = $1 AND shop_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [call.id, user.shopId],
    ),
    call.customer_id
      ? query<{
          id: string;
          kind: FollowUpKind;
          status: FollowUpStatus;
          title: string | null;
          body: string | null;
          scheduled_for: string;
          sent_at: string | null;
          created_at: string;
          source: string;
        }>(
          `SELECT id, kind, status, title, body, scheduled_for::text, sent_at::text, created_at::text, source
             FROM follow_ups WHERE customer_id = $1 AND shop_id = $2
            ORDER BY created_at DESC LIMIT 20`,
          [call.customer_id, user.shopId],
        )
      : Promise.resolve([]),
    call.customer_id
      ? query<{
          id: string;
          direction: string;
          channel: string;
          body: string;
          created_at: string;
          sent_by_agent: boolean;
        }>(
          `SELECT id, direction, channel, body, created_at::text, sent_by_agent
             FROM messages WHERE customer_id = $1 AND shop_id = $2
            ORDER BY created_at DESC LIMIT 20`,
          [call.customer_id, user.shopId],
        )
      : Promise.resolve([]),
  ]);

  const appointment = appointments[0] ?? null;
  const ticket =
    appointment?.repair_order_id && appointment.ro_number
      ? { id: appointment.repair_order_id, number: appointment.ro_number }
      : openedTickets[0]
        ? { id: openedTickets[0].id, number: openedTickets[0].number }
        : null;

  // The transcript: the conversation's messages, or the copy on the call row
  // for a call that predates conversations.
  const transcript =
    lines.length > 0
      ? lines.map((line) => ({ id: line.id, role: line.role, content: line.content, at: line.created_at }))
      : (call.transcript ?? []).map((line, index) => ({ id: String(index), role: line.role, content: line.content, at: null }));

  const intake = call.intake ?? {};
  const vehicleText =
    call.vehicle ??
    [intake.vehicle?.year, intake.vehicle?.make, intake.vehicle?.model].filter(Boolean).join(" ") ??
    null;
  const who = call.customer_name ?? call.caller_name ?? intake.customerName ?? formatPhone(call.from_number);

  /*
    The customer's journey: what ZOL queued and what actually went out or came
    in, newest first. Emerald where ZOL did it, amber where a person did — the
    customer's own texts count as a person.
  */
  const journey: TimelineItem[] = [
    ...followUps.map((f) => ({
      id: `f-${f.id}`,
      title: `${FOLLOW_UP_KIND_LABEL[f.kind] ?? f.kind} · ${FOLLOW_UP_STATUS_LABEL[f.status] ?? f.status}`,
      detail: f.body ?? f.title ?? undefined,
      at: f.sent_at ?? f.scheduled_for,
      actor: (f.source === "person" ? "person" : "zol") as "zol" | "person",
    })),
    ...messages.map((msg) => ({
      id: `m-${msg.id}`,
      title:
        msg.direction === "inbound"
          ? "Customer wrote"
          : msg.direction === "internal"
            ? "Internal note"
            : `Sent by ${msg.channel === "portal" ? "portal" : msg.channel}`,
      detail: msg.body,
      at: msg.created_at,
      actor: (msg.direction === "inbound" || !msg.sent_by_agent ? "person" : "zol") as "zol" | "person",
      by: msg.direction === "inbound" ? "Customer" : undefined,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 20);

  return (
    <>
      <PageHead
        eyebrow={`Call · ${formatDateTime(call.started_at, user.timezone)}`}
        title={who}
        description={`From ${formatPhone(call.from_number)} · ${duration(call.duration_seconds)}${
          call.sentiment ? ` · ${call.sentiment}` : ""
        } · answered by ${call.handled_by === "zol" ? "ZOL" : "a person"}`}
      >
        <StatusBadge kind="callOutcome" value={call.outcome ?? call.status} />
        {call.simulated && <Tag tone="neutral">Test call</Tag>}
        <Link href="/app/calls" className="btn btn-ghost btn-sm">
          All calls
        </Link>
      </PageHead>

      {call.simulated && (
        <Notice tone="neutral" className="mb-4">
          <strong className="font-semibold text-ink">Test call.</strong> Nothing rang — this transcript was
          scripted and pushed through the real receptionist pipeline. The customer, vehicle,
          appointment and queued confirmation are real rows in this shop.
        </Notice>
      )}

      {call.escalation_required && (
        <Notice tone="person" className="mb-4">
          <strong className="font-semibold">Needs a person.</strong>{" "}
          {intake.urgency === "stop_driving"
            ? "The caller was told not to drive the vehicle. Call them back."
            : call.outcome === "failed"
              ? (call.summary ?? "ZOL could not finish writing this call up.")
              : "ZOL could not complete the booking from the call. Call them back."}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section
          title="Transcript"
          detail={
            call.recording_url ? (
              <a href={call.recording_url} className="underline-offset-2 hover:underline">
                Recording
              </a>
            ) : (
              `${transcript.length} lines`
            )
          }
        >
          {transcript.length === 0 ? (
            <p className="text-[0.875rem] text-ink-3">No transcript was kept for this call.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {transcript.map((line) => {
                const zol = line.role === "assistant";
                const system = line.role === "system";
                return (
                  <li
                    key={line.id}
                    className={`flex flex-col ${system ? "items-center" : zol ? "items-start" : "items-end"}`}
                  >
                    {system ? (
                      <p className="t-eyebrow text-center">{line.content}</p>
                    ) : (
                      <>
                        <span className="t-eyebrow mb-1 px-1">{zol ? "ZOL" : who}</span>
                        <p
                          className={`max-w-[88%] rounded-[var(--radius)] border px-3.5 py-2.5 text-[0.9375rem] leading-relaxed ${
                            zol
                              ? "rounded-bl-sm border-emerald-line bg-emerald-wash text-ink"
                              : "rounded-br-sm border-line bg-paper-3 text-ink"
                          }`}
                        >
                          {line.content}
                        </p>
                        {line.at && (
                          <span className="t-data mt-1 px-1 text-[0.6875rem] text-ink-3">
                            {formatTime(line.at, user.timezone)}
                          </span>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        <div className="flex flex-col gap-6">
          <Section
            title="What ZOL took down"
            detail={
              call.intake_source === "openai"
                ? "Extracted by the model, checked against the keyword parser."
                : "Extracted by the deterministic parser — no OpenAI key configured."
            }
            action={intake.urgency ? <StatusBadge kind="urgency" value={intake.urgency} /> : undefined}
          >
            <Facts
              items={[
                { label: "Caller", value: intake.customerName ?? who },
                { label: "Phone", value: <span className="t-data">{formatPhone(intake.phone ?? call.from_number)}</span> },
                { label: "Vehicle", value: vehicleText || "Not given" },
                { label: "Complaint", value: intake.complaint ?? "—" },
                { label: "Service", value: intake.serviceType ?? "—" },
                { label: "Wanted", value: intake.preferredTime ?? "No preference" },
              ]}
            />
            {intake.symptoms && intake.symptoms.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {intake.symptoms.map((symptom) => (
                  <Tag key={symptom} tone="neutral">
                    {symptom}
                  </Tag>
                ))}
              </div>
            )}
            {intake.safetyAdvice && (
              <Notice tone={intake.urgency === "stop_driving" ? "red" : "person"} className="mt-4">
                <span className="t-eyebrow mr-2">Safety</span>
                {intake.safetyAdvice}
              </Notice>
            )}
            {call.summary && (
              <p className="mt-4 border-t border-line pt-3 text-[0.875rem] leading-relaxed text-ink-2">
                {call.summary}
              </p>
            )}
          </Section>

          <Section
            title="Booking"
            action={appointment ? <StatusBadge kind="appointment" value={appointment.status} /> : undefined}
          >
            {appointment ? (
              <>
                <Facts
                  items={[
                    { label: "When", value: formatWhen(appointment.starts_at, user.timezone) },
                    {
                      label: "Until",
                      value: formatTime(appointment.ends_at, user.timezone),
                    },
                    { label: "Technician", value: appointment.technician_name ?? "Assign at check-in" },
                    { label: "Bay", value: appointment.bay ? `Bay ${appointment.bay}` : "Decide later" },
                    { label: "Service", value: appointment.service_type ?? "—" },
                    {
                      label: "Confirmation",
                      value: call.sms_opted_out ? "Not sent — texts stopped" : "Queued to the customer",
                    },
                  ]}
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/app/schedule?date=${zonedDate(new Date(appointment.starts_at), user.timezone)}`}
                    className="btn btn-ghost btn-sm"
                  >
                    Open on the schedule
                  </Link>
                  {ticket && (
                    <Link href={`/app/repair-orders/${ticket.id}`} className="btn btn-ghost btn-sm">
                      Ticket #{ticket.number}
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[0.875rem] text-ink-2">
                Nothing was booked from this call.
                {call.customer_id && (
                  <>
                    {" "}
                    <Link
                      href={`/app/schedule/new?customer=${call.customer_id}`}
                      className="font-semibold text-emerald-deep underline-offset-2 hover:underline"
                    >
                      Book them in
                    </Link>
                    .
                  </>
                )}
              </p>
            )}
          </Section>

          <Section title="Links">
            <ul className="flex flex-col gap-2 text-[0.9375rem]">
              <li>
                {call.customer_id ? (
                  <Link href={`/app/customers/${call.customer_id}`} className="font-semibold text-ink underline-offset-4 hover:underline">
                    {call.customer_name ?? "Customer"}
                  </Link>
                ) : (
                  <span className="text-ink-3">No customer matched</span>
                )}
                <span className="t-data ml-2 text-[0.8125rem] text-ink-3">
                  {formatPhone(call.customer_phone ?? call.from_number)}
                </span>
              </li>
              <li>
                {call.vehicle_id ? (
                  <Link href={`/app/vehicles/${call.vehicle_id}`} className="font-semibold text-ink underline-offset-4 hover:underline">
                    {call.vehicle ?? "Vehicle"}
                  </Link>
                ) : (
                  <span className="text-ink-3">No vehicle matched</span>
                )}
              </li>
              <li>
                {ticket ? (
                  <Link href={`/app/repair-orders/${ticket.id}`} className="font-semibold text-ink underline-offset-4 hover:underline">
                    Ticket #{ticket.number}
                  </Link>
                ) : (
                  <span className="text-ink-3">No ticket yet — it opens at check-in</span>
                )}
              </li>
            </ul>
          </Section>

          <Section
            title="Customer journey"
            detail="What ZOL queued for this customer and what went out or came in."
          >
            <Timeline
              items={journey}
              timezone={user.timezone}
              empty={call.customer_id ? "Nothing sent or queued yet." : "No customer to follow."}
            />
          </Section>
        </div>
      </div>
    </>
  );
}
