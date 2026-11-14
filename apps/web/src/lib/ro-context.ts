import "server-only";

import { cache } from "react";

import type { RoContext } from "@/components/app/ro/contracts";
import type { Session } from "./auth";
import { query } from "./db";
import { vehicleLabel } from "./format";
import type { Priority, RoStatus, Source } from "./statuses";

/**
 * The ticket, resolved once.
 *
 * The repair order page is seven panels and a header, and every one of them
 * needs to know whose ticket it is, what car, what status, what the shop
 * charges. This is the one query that answers all of that; the page hands the
 * result to each panel as its `RoContext` and keeps the extra header fields
 * for itself. `cache` dedupes it across `generateMetadata` and the page body
 * within one render.
 *
 * The shop id comes from the session and lands in the WHERE. A ticket id from
 * the URL narrows; the session decides.
 */

export interface LoadedRepairOrder extends RoContext {
  plate: string | null;
  vin: string | null;
  cause: string | null;
  correction: string | null;
  priority: Priority;
  source: Source;
  promisedAt: string | null;
  /** The promised time has passed and the car isn't done. Decided by the database clock. */
  promisedLate: boolean;
  checkedInAt: string | null;
  createdAt: string;
  completedAt: string | null;
  closedAt: string | null;
  fuelLevel: number | null;
  visibleDamage: string | null;
  checkInNotes: string | null;
  approvedByName: string | null;
  partsMarginPct: string;
  /** The booking this ticket came in on, when there was one. */
  appointment: { id: string; startsAt: string; bay: number | null } | null;
}

interface Row {
  id: string;
  number: number;
  status: RoStatus;
  complaint: string | null;
  cause: string | null;
  correction: string | null;
  mileage_in: number | null;
  total_cents: number;
  approved_at: string | null;
  priority: Priority;
  source: Source;
  promised_at: string | null;
  promised_late: boolean;
  checked_in_at: string | null;
  created_at: string;
  completed_at: string | null;
  closed_at: string | null;
  fuel_level: number | null;
  visible_damage: string | null;
  check_in_notes: string | null;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string;
  customer_email: string | null;
  sms_opted_out: boolean;
  vehicle_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  plate: string | null;
  vin: string | null;
  technician_id: string | null;
  technician_name: string | null;
  approved_by_name: string | null;
  shop_name: string;
  labor_rate_cents: number;
  tax_rate_pct: string;
  parts_margin_pct: string;
  auto_quote_cap_cents: number;
  appointment_id: string | null;
  appointment_starts_at: string | null;
  appointment_bay: number | null;
}

export const loadRepairOrder = cache(
  async (id: string, user: Session): Promise<LoadedRepairOrder | null> => {
    // A malformed id would make Postgres throw on the uuid cast; treat it as
    // simply not found, which is what it is.
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

    const rows = await query<Row>(
      `SELECT ro.id, ro.number, ro.status, ro.complaint, ro.cause, ro.correction,
              ro.mileage_in, ro.total_cents, ro.approved_at::text, ro.priority, ro.source,
              ro.promised_at::text,
              (ro.promised_at IS NOT NULL AND ro.promised_at < now()
               AND ro.status NOT IN ('ready', 'closed', 'cancelled')) AS promised_late,
              ro.checked_in_at::text, ro.created_at::text,
              ro.completed_at::text, ro.closed_at::text,
              ro.fuel_level, ro.visible_damage, ro.check_in_notes,
              c.id AS customer_id, c.full_name AS customer_name, c.phone AS customer_phone,
              c.email AS customer_email, c.sms_opted_out,
              v.id AS vehicle_id, v.year, v.make, v.model, v.trim, v.plate, v.vin,
              t.id AS technician_id, t.full_name AS technician_name,
              approver.full_name AS approved_by_name,
              s.name AS shop_name, s.labor_rate_cents, s.tax_rate_pct, s.parts_margin_pct,
              s.auto_quote_cap_cents,
              a.id AS appointment_id, a.starts_at::text AS appointment_starts_at, a.bay AS appointment_bay
         FROM repair_orders ro
         JOIN customers c ON c.id = ro.customer_id
         JOIN shops s ON s.id = ro.shop_id
         LEFT JOIN vehicles v ON v.id = ro.vehicle_id
         LEFT JOIN staff t ON t.id = ro.technician_id
         LEFT JOIN staff approver ON approver.id = ro.approved_by
         LEFT JOIN LATERAL (
           SELECT ap.id, ap.starts_at, ap.bay
             FROM appointments ap
            WHERE ap.repair_order_id = ro.id AND ap.shop_id = ro.shop_id
            ORDER BY ap.starts_at DESC
            LIMIT 1
         ) a ON true
        WHERE ro.id = $1 AND ro.shop_id = $2`,
      [id, user.shopId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      shopId: user.shopId,
      shopName: row.shop_name,
      number: row.number,
      status: row.status,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerEmail: row.customer_email,
      smsOptedOut: row.sms_opted_out,
      vehicleId: row.vehicle_id,
      vehicleLabel: vehicleLabel(row),
      mileageIn: row.mileage_in,
      complaint: row.complaint,
      technicianId: row.technician_id,
      technicianName: row.technician_name,
      totalCents: row.total_cents,
      laborRateCents: row.labor_rate_cents,
      taxRatePct: row.tax_rate_pct,
      autoQuoteCapCents: row.auto_quote_cap_cents,
      approvedAt: row.approved_at,
      timezone: user.timezone,
      staffId: user.staffId,
      role: user.role,

      plate: row.plate,
      vin: row.vin,
      cause: row.cause,
      correction: row.correction,
      priority: row.priority,
      source: row.source,
      promisedAt: row.promised_at,
      promisedLate: row.promised_late,
      checkedInAt: row.checked_in_at,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      closedAt: row.closed_at,
      fuelLevel: row.fuel_level,
      visibleDamage: row.visible_damage,
      checkInNotes: row.check_in_notes,
      approvedByName: row.approved_by_name,
      partsMarginPct: row.parts_margin_pct,
      appointment:
        row.appointment_id && row.appointment_starts_at
          ? { id: row.appointment_id, startsAt: row.appointment_starts_at, bay: row.appointment_bay }
          : null,
    };
  },
);

/** Just the panel contract, for callers that don't need the header fields. */
export async function loadRoContext(id: string, user: Session): Promise<RoContext | null> {
  return loadRepairOrder(id, user);
}
