import Link from "next/link";
import { notFound } from "next/navigation";

import { approveRepairOrder } from "@/app/actions/repair-orders";
import { DeclinedForm } from "@/components/app/declined-form";
import { AssignmentForm, RepairOrderForm } from "@/components/app/ro-forms";
import { ConversationPanel } from "@/components/app/ro/conversation-panel";
import { DiagnosticsPanel } from "@/components/app/ro/diagnostics-panel";
import { EstimatePanel } from "@/components/app/ro/estimate-panel";
import { InspectionPanel } from "@/components/app/ro/inspection-panel";
import { InvoicePanel } from "@/components/app/ro/invoice-panel";
import { LinesPanel } from "@/components/app/ro/lines-panel";
import { PartsPanel } from "@/components/app/ro/parts-panel";
import { RoTimeline } from "@/components/app/ro/ro-timeline";
import { StatusControls } from "@/components/app/ro/status-controls";
import { Stepper } from "@/components/app/ro/stepper";
import { PageHead } from "@/components/app/shell";
import { Facts, Notice, Section, StatusBadge } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatMiles } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { loadRepairOrder } from "@/lib/ro-context";
import { zonedDate, zonedTime } from "@/lib/schedule";
import { RO_STATUS_LABEL, SOURCE_LABEL } from "@/lib/statuses";

export async function generateMetadata(props: PageProps<"/app/repair-orders/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();
  const ro = await loadRepairOrder(id, user);
  return { title: ro ? `RO #${ro.number}` : "Repair order" };
}

/**
 * The workbench.
 *
 * One screen, composed from panels that each own their rows. The header is
 * the ticket: who, what car, who has it, where it is on the line, and the
 * buttons that move it. Below, the main column is the work — the three C's,
 * the diagnosis, the inspection, the lines, the estimate, the parts — and
 * the side column is the paperwork: the facts, the invoice, the conversation
 * and the history. On a phone the side column follows the main one.
 */
export default async function RepairOrderPage(props: PageProps<"/app/repair-orders/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const { saved, pay } = await props.searchParams;

  // A payment the invoice refused, said in place. The reason rides in the URL
  // from actions/payments.ts; the card's own notification carries the amounts.
  const PAY_REFUSED: Record<string, string> = {
    already_paid: "That payment wasn't recorded — the invoice was already paid in full.",
    over_balance: "That payment wasn't recorded — it was more than the balance still owed.",
    void: "That payment wasn't recorded — the invoice is void.",
    duplicate: "That payment was already recorded; nothing was added twice.",
    bad_amount: "That payment wasn't recorded — the amount wasn't a valid dollar figure.",
    no_invoice: "There's no invoice on this ticket to record a payment against.",
  };
  const payNotice = typeof pay === "string" ? PAY_REFUSED[pay] : undefined;

  const ro = await loadRepairOrder(id, user);
  if (!ro) notFound();

  const technicians = await query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM staff
      WHERE shop_id = $1 AND role = 'tech' AND disabled_at IS NULL
      ORDER BY full_name`,
    [user.shopId],
  );

  const overCap = ro.totalCents > ro.autoQuoteCapCents;
  const closed = ro.status === "closed" || ro.status === "cancelled";
  const promised = ro.promisedAt ? new Date(ro.promisedAt) : null;
  const promisedLate = ro.promisedLate;

  return (
    <>
      <PageHead
        eyebrow={`Repair order #${ro.number} · ${RO_STATUS_LABEL[ro.status]}`}
        title={ro.customerName ?? "Unnamed"}
      >
        <Link href="/app/repair-orders" className="btn btn-ghost btn-sm">
          Board
        </Link>
        <Link href={`/app/customers/${ro.customerId}`} className="btn btn-ghost btn-sm">
          Customer
        </Link>
        <Link href={`/app/schedule/new?customer=${ro.customerId}`} className="btn btn-ghost btn-sm">
          Book a bay
        </Link>
      </PageHead>

      {saved && (
        <Notice tone="zol" className="mb-5 font-semibold">
          Saved.
        </Notice>
      )}
      {payNotice && (
        <Notice tone="person" className="mb-5 font-semibold">
          {payNotice}
        </Notice>
      )}

      <div className="card mb-6 flex flex-col gap-5 p-4 sm:p-5">
        <Stepper status={ro.status} />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.9375rem]">
          <StatusBadge kind="ro" value={ro.status} />
          {ro.vehicleLabel ? (
            <span className="text-ink">
              {ro.vehicleId ? (
                <Link href={`/app/vehicles/${ro.vehicleId}`} className="font-semibold underline-offset-4 hover:underline">
                  {ro.vehicleLabel}
                </Link>
              ) : (
                <span className="font-semibold">{ro.vehicleLabel}</span>
              )}
              {ro.plate && <span className="t-data ml-2 text-[0.8125rem] text-ink-3">{ro.plate}</span>}
              {ro.mileageIn !== null && (
                <span className="t-data ml-2 text-[0.8125rem] text-ink-3">{formatMiles(ro.mileageIn)}</span>
              )}
            </span>
          ) : (
            <span className="text-ink-3">No vehicle on the ticket</span>
          )}
          <a href={`tel:${ro.customerPhone}`} className="t-data text-ink-2 underline-offset-4 hover:underline">
            {formatPhone(ro.customerPhone)}
          </a>
          {ro.smsOptedOut && <span className="tag tag-person">Texts stopped</span>}
          {(ro.priority === "high" || ro.priority === "urgent") && (
            <StatusBadge kind="priority" value={ro.priority} />
          )}
          <span className="text-[0.875rem] text-ink-2">
            {ro.technicianName ? (
              <>
                <span className="text-ink-3">Tech </span>
                {ro.technicianName}
              </>
            ) : (
              <span className="text-ink-3">Unassigned</span>
            )}
          </span>
          {promised && (
            <span className={`text-[0.875rem] ${promisedLate ? "font-semibold text-amber-deep" : "text-ink-2"}`}>
              <span className="text-ink-3">Promised </span>
              {formatDateTime(promised, user.timezone)}
              {promisedLate && " — overdue"}
            </span>
          )}
        </div>

        {!closed && (
          <div className="flex flex-col gap-4 border-t border-line pt-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1">
              <AssignmentForm
                key={`${ro.technicianId ?? ""}-${ro.priority}-${ro.promisedAt ?? ""}`}
                repairOrderId={ro.id}
                technicianId={ro.technicianId}
                priority={ro.priority}
                promisedAt={
                  promised ? `${zonedDate(promised, user.timezone)}T${zonedTime(promised, user.timezone)}` : null
                }
                technicians={technicians.map((tech) => ({ id: tech.id, name: tech.full_name }))}
              />
            </div>
            <div className="flex-none">
              <StatusControls repairOrderId={ro.id} status={ro.status} />
            </div>
          </div>
        )}
        {closed && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-[0.875rem] text-ink-2">
              {ro.status === "closed" ? "Closed" : "Cancelled"}
              {ro.closedAt && ` ${formatDateTime(ro.closedAt, user.timezone)}`}.
            </p>
            <StatusControls repairOrderId={ro.id} status={ro.status} />
          </div>
        )}
      </div>

      {/*
        The cap. Above it, nothing is supposed to reach a customer until a
        person here has said the number out loud is fine. It's the control the
        whole risk of an agent quoting sits behind, so it's stated plainly at
        the top of the ticket rather than buried in settings.
      */}
      {overCap && !ro.approvedAt && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-amber-line bg-amber-wash p-4">
          <div>
            <p className="text-[0.9375rem] font-semibold text-amber-deep">
              {formatCents(ro.totalCents)} is over your {formatCents(ro.autoQuoteCapCents)} cap.
            </p>
            <p className="mt-0.5 text-[0.875rem] text-ink-2">
              Nothing goes to the customer at this price until somebody here approves it.
            </p>
          </div>
          <form action={approveRepairOrder}>
            <input type="hidden" name="id" value={ro.id} />
            <button type="submit" className="btn btn-emerald btn-sm">
              Approve this price
            </button>
          </form>
        </div>
      )}

      {ro.approvedAt && (
        <p className="mb-6 text-[0.875rem] text-ink-2">
          <span className="tag tag-person mr-2">Approved</span>
          {ro.approvedByName ?? "Someone"} on {formatDateTime(ro.approvedAt, user.timezone)}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="The ticket" detail="Complaint, cause, correction.">
            <RepairOrderForm
              ro={{
                id: ro.id,
                complaint: ro.complaint,
                cause: ro.cause,
                correction: ro.correction,
                mileage_in: ro.mileageIn,
              }}
            />
          </Section>

          <DiagnosticsPanel ro={ro} />
          <InspectionPanel ro={ro} />
          <LinesPanel ro={ro} />
          <EstimatePanel ro={ro} />
          <PartsPanel ro={ro} />

          {/*
            Recorded from the ticket because that is the moment it happens —
            the advisor is on the phone hearing "not today", and anywhere else
            means it never gets written down.
          */}
          <Section
            title="Turned something down?"
            detail="Write it here and it lands on the recall list instead of being forgotten."
          >
            <DeclinedForm customerId={ro.customerId} vehicleId={ro.vehicleId} repairOrderId={ro.id} />
          </Section>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <Section title="Facts">
            <Facts
              items={[
                { label: "Source", value: SOURCE_LABEL[ro.source] ?? ro.source },
                { label: "Opened", value: formatDateTime(ro.createdAt, user.timezone) },
                {
                  label: "Checked in",
                  value: ro.checkedInAt ? formatDateTime(ro.checkedInAt, user.timezone) : "Not yet",
                },
                ...(ro.appointment
                  ? [
                      {
                        label: "Appointment",
                        value: (
                          <Link href={`/app/schedule?date=${zonedDate(new Date(ro.appointment.startsAt), user.timezone)}`} className="underline-offset-4 hover:underline">
                            {formatDateTime(ro.appointment.startsAt, user.timezone)}
                            {ro.appointment.bay ? ` · bay ${ro.appointment.bay}` : ""}
                          </Link>
                        ),
                      },
                    ]
                  : []),
                { label: "Fuel", value: ro.fuelLevel === null ? "—" : `${ro.fuelLevel}%` },
                {
                  label: "Promised",
                  value: promised ? formatDateTime(promised, user.timezone) : "—",
                },
                ...(ro.completedAt
                  ? [{ label: "Completed", value: formatDateTime(ro.completedAt, user.timezone) }]
                  : []),
                ...(ro.vin ? [{ label: "VIN", value: <span className="t-data text-[0.8125rem]">{ro.vin}</span> }] : []),
              ]}
            />
            {(ro.visibleDamage || ro.checkInNotes) && (
              <dl className="mt-4 flex flex-col gap-3 border-t border-line pt-4 text-[0.875rem]">
                {ro.visibleDamage && (
                  <div>
                    <dt className="t-eyebrow mb-0.5">Visible damage at check-in</dt>
                    <dd className="text-ink-2">{ro.visibleDamage}</dd>
                  </div>
                )}
                {ro.checkInNotes && (
                  <div>
                    <dt className="t-eyebrow mb-0.5">Check-in notes</dt>
                    <dd className="text-ink-2">{ro.checkInNotes}</dd>
                  </div>
                )}
              </dl>
            )}
          </Section>

          <InvoicePanel ro={ro} />
          <ConversationPanel ro={ro} />
          <RoTimeline ro={ro} />
        </aside>
      </div>
    </>
  );
}
