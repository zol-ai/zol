import "server-only";

import type { Queryable } from "./db";
import { zonedDate } from "./schedule";
import type {
  AppointmentStatus,
  EstimateStatus,
  InvoiceStatus,
  RoStatus,
} from "./statuses";

/**
 * One box, everything in it.
 *
 * The person at the counter has a name, or the last four of a phone, or a
 * plate, or "#1047", or "the Camry with the brake noise" — and no patience
 * for picking which field to search first. So the query is read once into
 * the handful of shapes it might be (words, digits, a number, something
 * plate-shaped) and every group is asked the question it can answer, in a
 * single round trip.
 *
 * The reading is pure and tested (search.test.ts). The SQL is here beside
 * it because the two have to agree on what each parameter means.
 */

export const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const MAX_WORDS = 6;
const GROUP_LIMIT = 10;

export interface SearchTerms {
  /** Trimmed, whitespace-collapsed, length-capped. What the page echoes back. */
  text: string;
  /** Each word as a LIKE pattern with the wildcards escaped: "%honda%". */
  patterns: string[];
  /** Every digit in the query, for matching inside a stored E.164. Empty under three digits. */
  digits: string;
  /** "1047" when the query is a bare number or "#1047"; the ticket/estimate/invoice number. */
  number: string;
  /** Upper-cased, alphanumerics only, for plates and VINs. Empty under two characters. */
  plate: string;
}

/** `%` and `_` are wildcards in LIKE; a customer called "100%" should still be findable. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Read the query. Returns null when there is nothing worth asking the
 * database — an empty box, a single character.
 */
export function parseSearch(raw: string | null | undefined): SearchTerms | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  if (text.length < MIN_QUERY_LENGTH) return null;

  const words = text.split(" ").filter(Boolean).slice(0, MAX_WORDS);
  const patterns = words.map((word) => `%${escapeLike(word)}%`);

  const digitsOnly = text.replace(/\D/g, "");
  const digits = digitsOnly.length >= 3 ? digitsOnly : "";

  // "#1047", "1047", "ro 1047": a number on its own is a ticket, estimate or
  // invoice number first and a phone fragment second.
  const numberMatch = /^(?:#|ro\s*#?|est(?:imate)?\s*#?|inv(?:oice)?\s*#?)?(\d{1,7})$/i.exec(text);
  const number = numberMatch ? numberMatch[1] : "";

  const plateish = text.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const plate = plateish.length >= 2 ? plateish : "";

  return { text, patterns, digits, number, plate };
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface CustomerHit {
  id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  vehicle: string | null;
}

export interface VehicleHit {
  id: string;
  label: string | null;
  plate: string | null;
  vin: string | null;
  customer_id: string;
  customer_name: string | null;
}

export interface RepairOrderHit {
  id: string;
  number: number;
  status: RoStatus;
  complaint: string | null;
  customer_name: string | null;
  vehicle: string | null;
}

export interface AppointmentHit {
  id: string;
  starts_at: string;
  status: AppointmentStatus;
  service_type: string | null;
  complaint: string | null;
  customer_name: string | null;
  vehicle: string | null;
  upcoming: boolean;
}

export interface EstimateHit {
  id: string;
  number: number;
  status: EstimateStatus;
  total_cents: number;
  customer_name: string | null;
  repair_order_id: string;
  ro_number: number;
}

export interface InvoiceHit {
  id: string;
  number: number;
  status: InvoiceStatus;
  total_cents: number;
  paid_cents: number;
  customer_name: string | null;
  repair_order_id: string;
  ro_number: number;
}

export interface SearchResults {
  customers: CustomerHit[];
  vehicles: VehicleHit[];
  repairOrders: RepairOrderHit[];
  appointments: AppointmentHit[];
  estimates: EstimateHit[];
  invoices: InvoiceHit[];
}

export function countResults(results: SearchResults): number {
  return Object.values(results).reduce((sum, group) => sum + group.length, 0);
}

// -----------------------------------------------------------------------------
// Where each hit goes
// -----------------------------------------------------------------------------

export function customerHref(hit: { id: string }): string {
  return `/app/customers/${hit.id}`;
}

export function vehicleHref(hit: { id: string }): string {
  return `/app/vehicles/${hit.id}`;
}

export function repairOrderHref(hit: { id: string }): string {
  return `/app/repair-orders/${hit.id}`;
}

/** The schedule shows a day; the day is the appointment's, on the shop's calendar. */
export function appointmentHref(hit: { starts_at: string | Date }, timeZone: string): string {
  return `/app/schedule?date=${zonedDate(new Date(hit.starts_at), timeZone)}`;
}

export function estimateHref(hit: { number: number }): string {
  return `/app/estimates?q=${hit.number}`;
}

export function invoiceHref(hit: { number: number }): string {
  return `/app/invoices?q=${hit.number}`;
}

// -----------------------------------------------------------------------------
// The query
// -----------------------------------------------------------------------------

interface ResultRow {
  customers: CustomerHit[];
  vehicles: VehicleHit[];
  repair_orders: RepairOrderHit[];
  appointments: AppointmentHit[];
  estimates: EstimateHit[];
  invoices: InvoiceHit[];
}

/**
 * Six groups, one statement. Each group is a json_agg subselect, so a search
 * is one round trip however many kinds of thing it matches.
 *
 *   $1 shop      $2 word patterns (text[])   $3 digits
 *   $4 number    $5 plate/VIN fragment       $6 limit per group
 *
 * `ILIKE ALL ($2)` is "every word appears somewhere in this field", which is
 * what lets "civic honda" find a 2012 Honda Civic. A parameter that came
 * back empty from parseSearch is guarded with `<> ''` so the branch simply
 * contributes nothing rather than matching everything.
 */
export async function runSearch(
  client: Queryable,
  shopId: string,
  terms: SearchTerms,
): Promise<SearchResults> {
  const { rows } = await client.query<ResultRow>(
    `SELECT
       (SELECT coalesce(json_agg(t), '[]'::json) FROM (
          SELECT c.id, c.full_name, c.phone, c.email,
                 (SELECT nullif(concat_ws(' ', v.year::text, v.make, v.model), '')
                    FROM vehicles v
                   WHERE v.customer_id = c.id
                   ORDER BY v.created_at DESC LIMIT 1) AS vehicle
            FROM customers c
           WHERE c.shop_id = $1
             AND (c.full_name ILIKE ALL ($2::text[])
                  OR c.email ILIKE ALL ($2::text[])
                  OR ($3 <> '' AND c.phone LIKE '%' || $3 || '%'))
           ORDER BY (c.phone LIKE '%' || $3 || '%' AND $3 <> '') DESC, c.full_name
           LIMIT $6
        ) t) AS customers,

       (SELECT coalesce(json_agg(t), '[]'::json) FROM (
          SELECT v.id,
                 nullif(concat_ws(' ', v.year::text, v.make, v.model, v.trim), '') AS label,
                 v.plate, v.vin, v.customer_id, c.full_name AS customer_name
            FROM vehicles v
            JOIN customers c ON c.id = v.customer_id
           WHERE v.shop_id = $1
             AND (concat_ws(' ', v.year::text, v.make, v.model, v.trim) ILIKE ALL ($2::text[])
                  OR ($5 <> '' AND regexp_replace(upper(v.plate), '[^A-Z0-9]', '', 'g')
                                   LIKE '%' || $5 || '%')
                  OR ($5 <> '' AND v.vin LIKE '%' || $5 || '%'))
           ORDER BY v.updated_at DESC
           LIMIT $6
        ) t) AS vehicles,

       (SELECT coalesce(json_agg(t), '[]'::json) FROM (
          SELECT ro.id, ro.number, ro.status, ro.complaint,
                 c.full_name AS customer_name,
                 nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle
            FROM repair_orders ro
            JOIN customers c ON c.id = ro.customer_id
            LEFT JOIN vehicles v ON v.id = ro.vehicle_id
           WHERE ro.shop_id = $1
             AND (($4 <> '' AND ro.number::text LIKE $4 || '%')
                  OR ro.complaint ILIKE ALL ($2::text[]))
           ORDER BY (ro.number::text = $4) DESC, ro.created_at DESC
           LIMIT $6
        ) t) AS repair_orders,

       -- Upcoming first, soonest at the top; then the past, most recent first.
       (SELECT coalesce(json_agg(t), '[]'::json) FROM (
          SELECT a.id, a.starts_at, a.status, a.service_type, a.complaint,
                 c.full_name AS customer_name,
                 nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
                 a.starts_at >= now() AS upcoming
            FROM appointments a
            JOIN customers c ON c.id = a.customer_id
            LEFT JOIN vehicles v ON v.id = a.vehicle_id
           WHERE a.shop_id = $1
             AND (a.service_type ILIKE ALL ($2::text[])
                  OR a.complaint ILIKE ALL ($2::text[]))
           ORDER BY (a.starts_at >= now()) DESC,
                    CASE WHEN a.starts_at >= now() THEN a.starts_at END ASC,
                    a.starts_at DESC
           LIMIT $6
        ) t) AS appointments,

       (SELECT coalesce(json_agg(t), '[]'::json) FROM (
          SELECT e.id, e.number, e.status, e.total_cents,
                 c.full_name AS customer_name,
                 e.repair_order_id, ro.number AS ro_number
            FROM estimates e
            JOIN customers c ON c.id = e.customer_id
            JOIN repair_orders ro ON ro.id = e.repair_order_id
           WHERE e.shop_id = $1
             AND $4 <> '' AND e.number::text LIKE $4 || '%'
           ORDER BY (e.number::text = $4) DESC, e.created_at DESC
           LIMIT $6
        ) t) AS estimates,

       (SELECT coalesce(json_agg(t), '[]'::json) FROM (
          SELECT i.id, i.number, i.status, i.total_cents, i.paid_cents,
                 c.full_name AS customer_name,
                 i.repair_order_id, ro.number AS ro_number
            FROM invoices i
            JOIN customers c ON c.id = i.customer_id
            JOIN repair_orders ro ON ro.id = i.repair_order_id
           WHERE i.shop_id = $1
             AND $4 <> '' AND i.number::text LIKE $4 || '%'
           ORDER BY (i.number::text = $4) DESC, i.created_at DESC
           LIMIT $6
        ) t) AS invoices`,
    [shopId, terms.patterns, terms.digits, terms.number, terms.plate, GROUP_LIMIT],
  );

  const row = rows[0];
  return {
    customers: row.customers,
    vehicles: row.vehicles,
    repairOrders: row.repair_orders,
    appointments: row.appointments,
    estimates: row.estimates,
    invoices: row.invoices,
  };
}
