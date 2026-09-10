import Link from "next/link";

import { setAppointmentStatus } from "@/app/actions/appointments";
import { CheckInForm, type TechnicianOption } from "@/components/app/check-in-form";
import { Avatar, StatusBadge, Tag } from "@/components/app/ui";
import { formatPhone } from "@/lib/phone";
import { clockLabel, zonedTime } from "@/lib/schedule";
import { SOURCE_LABEL, type Tone } from "@/lib/statuses";

export interface Slot {
  id: string;
  bay: number | null;
  starts_at: string;
  ends_at: string;
  status: string;
  booked_by_agent: boolean;
  source: string;
  customer_id: string;
  customer_name: string | null;
  phone: string;
  vehicle_id: string | null;
  vehicle: string | null;
  vehicle_mileage: number | null;
  repair_order_id: string | null;
  ro_number: number | null;
  technician_id: string | null;
  technician_name: string | null;
  service_type: string | null;
  complaint: string | null;
  notes: string | null;
  call_id: string | null;
}

/**
 * Where a booking came in through. Emerald for ZOL, amber for a person at
 * the counter — the app's one colour system — and blue for the doors a
 * customer walked through themselves.
 */
const SOURCE_TONE: Record<string, Tone> = {
  agent: "zol",
  counter: "person",
  web: "blue",
  call: "blue",
  portal: "violet",
};

function snippet(text: string | null, max = 110): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** One appointment on the day, with everything the advisor presses. */
export function SlotCard({
  slot,
  date,
  timezone,
  technicians,
  openCheckIn = false,
}: {
  slot: Slot;
  date: string;
  timezone: string;
  technicians: TechnicianOption[];
  /** Arrive with the check-in already unfolded (?checkin=<id>). */
  openCheckIn?: boolean;
}) {
  const live = slot.status === "booked" || slot.status === "confirmed";
  const needsTicket = slot.status === "arrived" && !slot.repair_order_id;
  const written = slot.status === "cancelled" || slot.status === "no_show";

  return (
    <li id={`slot-${slot.id}`} className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/* On a phone the time takes its own line: squeezed next to the
            name it left about twenty characters for the customer. */}
        <span className="t-data w-full flex-none pt-0.5 text-[0.875rem] text-ink sm:w-36">
          {clockLabel(zonedTime(new Date(slot.starts_at), timezone))}
          <span className="text-ink-3">
            {" – "}
            {clockLabel(zonedTime(new Date(slot.ends_at), timezone))}
          </span>
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] leading-snug">
            <Link
              href={`/app/customers/${slot.customer_id}`}
              className="font-semibold text-ink underline-offset-4 hover:underline"
            >
              {slot.customer_name ?? "Unnamed"}
            </Link>
            <span className="text-ink-2"> · {slot.vehicle ?? "No vehicle on file"}</span>
          </p>

          {(slot.service_type || slot.complaint) && (
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-2">
              {slot.service_type && <span className="font-semibold text-ink">{slot.service_type}</span>}
              {slot.service_type && slot.complaint && " — "}
              {snippet(slot.complaint)}
            </p>
          )}

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-ink-3">
            <span className="t-data">{formatPhone(slot.phone)}</span>
            {slot.technician_name ? (
              <span className="inline-flex items-center gap-1.5 text-ink-2">
                <Avatar name={slot.technician_name} size="sm" />
                {slot.technician_name}
              </span>
            ) : (
              <span>No technician yet</span>
            )}
            {slot.ro_number && slot.repair_order_id && (
              <Link
                href={`/app/repair-orders/${slot.repair_order_id}`}
                className="t-data text-ink underline-offset-2 hover:underline"
              >
                #{slot.ro_number}
              </Link>
            )}
            {slot.call_id && (
              <Link href={`/app/calls/${slot.call_id}`} className="underline-offset-2 hover:underline">
                From a call
              </Link>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone={SOURCE_TONE[slot.source] ?? "neutral"}>
            {slot.source === "agent" ? "ZOL booked" : (SOURCE_LABEL[slot.source as keyof typeof SOURCE_LABEL] ?? slot.source)}
          </Tag>
          <StatusBadge kind="appointment" value={slot.status} />
        </div>
      </div>

      {/* The buttons. Confirm and Arrived are what get pressed on a Tuesday
          morning; the other two are there for the days that go wrong. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:pl-40">
        {slot.repair_order_id ? (
          <Link href={`/app/repair-orders/${slot.repair_order_id}`} className="btn btn-ghost btn-sm">
            Open ticket #{slot.ro_number}
          </Link>
        ) : written ? (
          <Link
            href={`/app/schedule/new?customer=${slot.customer_id}&date=${date}`}
            className="btn btn-ghost btn-sm"
          >
            Rebook
          </Link>
        ) : (
          <>
            {slot.status === "booked" && (
              <form action={setAppointmentStatus}>
                <input type="hidden" name="id" value={slot.id} />
                <input type="hidden" name="date" value={date} />
                <button type="submit" name="status" value="confirmed" className="btn btn-ghost btn-sm">
                  Confirm
                </button>
              </form>
            )}

            {(live || needsTicket) && (
              <CheckInForm
                appointmentId={slot.id}
                date={date}
                technicians={technicians}
                defaultTechnicianId={slot.technician_id}
                complaint={slot.complaint ?? slot.service_type}
                mileage={slot.vehicle_mileage}
                initiallyOpen={openCheckIn}
              />
            )}

            {live && (
              <form action={setAppointmentStatus} className="flex gap-2">
                <input type="hidden" name="id" value={slot.id} />
                <input type="hidden" name="date" value={date} />
                <button type="submit" name="status" value="no_show" className="btn btn-ghost btn-sm">
                  No-show
                </button>
                <button type="submit" name="status" value="cancelled" className="btn btn-ghost btn-sm">
                  Cancel
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </li>
  );
}
