import type { Role } from "@/lib/auth";
import type { RoStatus } from "@/lib/statuses";

/**
 * What the repair order page hands to each panel it composes.
 *
 * The ticket is one screen built from several concerns — diagnosis,
 * inspection, lines and estimate, parts, invoice, conversation, history —
 * and each panel fetches its own rows. This is the little they all need to
 * know about the ticket to do that, resolved once by the page so seven
 * panels don't run seven copies of the same header query.
 */
export interface RoContext {
  id: string;
  shopId: string;
  shopName: string;
  number: number;
  status: RoStatus;
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  customerEmail: string | null;
  smsOptedOut: boolean;
  vehicleId: string | null;
  /** "2015 Chevrolet Sonic LT", or null when no vehicle is on the ticket. */
  vehicleLabel: string | null;
  mileageIn: number | null;
  complaint: string | null;
  technicianId: string | null;
  technicianName: string | null;
  totalCents: number;
  laborRateCents: number;
  /** numeric(5,2) comes back from pg as a string. */
  partsMarginPct: string;
  taxRatePct: string;
  autoQuoteCapCents: number;
  approvedAt: string | null;
  timezone: string;
  /** The signed-in person, for actions the panel renders. */
  staffId: string;
  role: Role;
}
