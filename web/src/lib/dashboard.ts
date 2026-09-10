import "server-only";

import { query } from "./db";
import type { AppointmentStatus, RoStatus, Source } from "./statuses";

/**
 * Everything the Today screen shows, in two round trips.
 *
 * The owner opens this on a phone in the bay, on shop wifi that drops when
 * the compressor kicks in. Fifteen queries from a serverless function is
 * fifteen times the latency for one screen, so the numbers come back as one
 * row of scalars and the lists come back as one row of JSON arrays — each
 * list a subselect aggregated with json_agg, which Postgres plans once and
 * runs in a single pass over the pool.
 *
 * Every subselect is scoped by shop_id, and every "today" is the shop's
 * today: `AT TIME ZONE` on the stored instant, never the server clock.
 */

export interface DashboardMetrics {
  appointmentsToday: number;
  openRepairOrders: number;
  needsApproval: number;
  awaitingParts: number;
  ready: number;
  unpaidCount: number;
  unpaidCents: number;
  revenueMonthCents: number;
  /** Distinct invoices that took a payment this month; the divisor for average ticket. */
  paidInvoicesMonth: number;
}

export interface SetupState {
  staff: number;
  hasHours: boolean;
  twilioNumber: string | null;
  complete: boolean;
}

export interface TodayAppointment {
  id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  source: Source;
  booked_by_agent: boolean;
  bay: number | null;
  service_type: string | null;
  complaint: string | null;
  customer_id: string;
  customer_name: string | null;
  vehicle: string | null;
  technician: string | null;
  repair_order_id: string | null;
  ro_number: number | null;
}

export type AttentionKind = "estimate" | "part" | "ticket" | "message" | "follow_up";

export interface AttentionItem {
  kind: AttentionKind;
  id: string;
  title: string;
  detail: string | null;
  /** The instant the item became worth looking at: sent, expected, opened, received, due. */
  at: string;
  href: string;
}

export interface PipelineCount {
  status: RoStatus;
  n: number;
}

export interface TechnicianLoad {
  id: string;
  full_name: string;
  specialties: string[];
  tickets: number;
  /** Book hours on labour lines across their open tickets. */
  hours: number;
}

export interface ActivityItem {
  id: string;
  kind: string;
  detail: string | null;
  actor: "zol" | "person";
  staff_name: string | null;
  created_at: string;
  repair_order_id: string;
  ro_number: number;
}

export interface Dashboard {
  metrics: DashboardMetrics;
  setup: SetupState;
  appointments: TodayAppointment[];
  attention: AttentionItem[];
  pipeline: PipelineCount[];
  workload: TechnicianLoad[];
  activity: ActivityItem[];
}

interface ScalarRow {
  appointments_today: number;
  open_ros: number;
  needs_approval: number;
  awaiting_parts: number;
  ready: number;
  unpaid_count: number;
  unpaid_cents: string;
  revenue_month_cents: string;
  paid_invoices_month: number;
  staff: number;
  has_hours: boolean;
  twilio_number: string | null;
}

interface ListRow {
  appointments: TodayAppointment[];
  attention: AttentionItem[];
  pipeline: PipelineCount[];
  workload: TechnicianLoad[];
  activity: ActivityItem[];
}

export async function loadDashboard(shopId: string, timezone: string): Promise<Dashboard> {
  const [scalars, lists] = await Promise.all([
    query<ScalarRow>(
      `WITH local AS (
         SELECT (now() AT TIME ZONE $2)::date              AS today,
                date_trunc('month', now() AT TIME ZONE $2) AS month_start
       )
       SELECT
         (SELECT count(*)::int FROM appointments a, local
           WHERE a.shop_id = $1
             AND a.status NOT IN ('cancelled', 'no_show')
             AND (a.starts_at AT TIME ZONE $2)::date = local.today)        AS appointments_today,
         (SELECT count(*)::int FROM repair_orders
           WHERE shop_id = $1 AND status NOT IN ('closed', 'cancelled'))     AS open_ros,
         (SELECT count(*)::int FROM repair_orders
           WHERE shop_id = $1 AND status = 'awaiting_approval')              AS needs_approval,
         (SELECT count(*)::int FROM repair_orders
           WHERE shop_id = $1 AND status = 'awaiting_parts')                 AS awaiting_parts,
         (SELECT count(*)::int FROM repair_orders
           WHERE shop_id = $1 AND status = 'ready')                          AS ready,
         (SELECT count(*)::int FROM invoices
           WHERE shop_id = $1 AND status IN ('open', 'partial'))             AS unpaid_count,
         (SELECT coalesce(sum(total_cents - paid_cents), 0)::bigint FROM invoices
           WHERE shop_id = $1 AND status IN ('open', 'partial'))             AS unpaid_cents,
         /*
           Revenue is money that actually landed: succeeded payments, dated by
           when they were processed, inside the shop's calendar month. Not
           invoices raised, which is the number a shop quotes and the number
           that lies to it.
         */
         (SELECT coalesce(sum(p.amount_cents), 0)::bigint FROM payments p, local
           WHERE p.shop_id = $1 AND p.status = 'succeeded'
             AND (coalesce(p.processed_at, p.created_at) AT TIME ZONE $2) >= local.month_start)
                                                                             AS revenue_month_cents,
         (SELECT count(DISTINCT p.invoice_id)::int FROM payments p, local
           WHERE p.shop_id = $1 AND p.status = 'succeeded'
             AND (coalesce(p.processed_at, p.created_at) AT TIME ZONE $2) >= local.month_start)
                                                                             AS paid_invoices_month,
         (SELECT count(*)::int FROM staff
           WHERE shop_id = $1 AND disabled_at IS NULL)                       AS staff,
         (SELECT count(*) > 0 FROM shop_hours
           WHERE shop_id = $1 AND NOT is_closed)                             AS has_hours,
         (SELECT twilio_number FROM shops WHERE id = $1)                     AS twilio_number`,
      [shopId, timezone],
    ),
    query<ListRow>(
      `SELECT
         -- Today's book, in order, with whatever has already happened to it.
         (SELECT coalesce(json_agg(t ORDER BY t.starts_at, t.bay NULLS LAST), '[]'::json)
            FROM (
              SELECT a.id, a.starts_at, a.ends_at, a.status, a.source, a.booked_by_agent,
                     a.bay, a.service_type, a.complaint, a.customer_id,
                     c.full_name AS customer_name,
                     nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
                     s.full_name AS technician,
                     a.repair_order_id, ro.number AS ro_number
                FROM appointments a
                JOIN customers c ON c.id = a.customer_id
                LEFT JOIN vehicles v ON v.id = a.vehicle_id
                LEFT JOIN staff s ON s.id = a.technician_id
                LEFT JOIN repair_orders ro ON ro.id = a.repair_order_id
               WHERE a.shop_id = $1
                 AND a.status <> 'cancelled'
                 AND (a.starts_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
            ) t)                                                            AS appointments,

         /*
           Needs attention: five different tables, one list, oldest first —
           the thing that has been waiting longest is the thing to do next.
           Each branch is a real condition a shop loses money on, not a
           heuristic; a row here means somebody should pick up the phone.
         */
         (SELECT coalesce(json_agg(t ORDER BY t.at), '[]'::json)
            FROM (
              SELECT * FROM (
                SELECT 'estimate'::text AS kind, e.id,
                       'Estimate #' || e.number || ' still unanswered' AS title,
                       concat_ws(' · ', c.full_name,
                                 nullif(concat_ws(' ', v.year::text, v.make, v.model), ''),
                                 CASE WHEN e.viewed_at IS NOT NULL
                                      THEN 'opened by the customer'
                                      ELSE 'not opened yet' END) AS detail,
                       coalesce(e.sent_at, e.created_at) AS at,
                       '/app/repair-orders/' || e.repair_order_id AS href
                  FROM estimates e
                  JOIN customers c ON c.id = e.customer_id
                  LEFT JOIN vehicles v ON v.id = e.vehicle_id
                 WHERE e.shop_id = $1
                   AND e.status IN ('sent', 'viewed')
                   AND e.responded_at IS NULL
                   AND coalesce(e.sent_at, e.created_at) < now() - interval '24 hours'

                UNION ALL
                SELECT 'part', p.id,
                       'Late part: ' || p.name,
                       concat_ws(' · ', '#' || ro.number, p.supplier,
                                 initcap(p.status)),
                       p.expected_at,
                       '/app/repair-orders/' || p.repair_order_id
                  FROM parts p
                  JOIN repair_orders ro ON ro.id = p.repair_order_id
                 WHERE p.shop_id = $1
                   AND p.status IN ('needed', 'requested', 'ordered')
                   AND p.expected_at < now()

                UNION ALL
                SELECT 'ticket', ro.id,
                       '#' || ro.number || CASE ro.status
                                             WHEN 'open' THEN ' still open'
                                             ELSE ' still diagnosing' END,
                       concat_ws(' · ', c.full_name,
                                 nullif(concat_ws(' ', v.year::text, v.make, v.model), ''),
                                 s.full_name),
                       ro.created_at,
                       '/app/repair-orders/' || ro.id
                  FROM repair_orders ro
                  JOIN customers c ON c.id = ro.customer_id
                  LEFT JOIN vehicles v ON v.id = ro.vehicle_id
                  LEFT JOIN staff s ON s.id = ro.technician_id
                 WHERE ro.shop_id = $1
                   AND ro.status IN ('open', 'diagnosing')
                   AND ro.created_at < now() - interval '2 days'

                UNION ALL
                SELECT 'message', m.id,
                       CASE m.channel WHEN 'sms' THEN 'Text'
                                      WHEN 'email' THEN 'Email'
                                      ELSE 'Message' END
                         || ' from ' || coalesce(c.full_name, c.phone),
                       left(m.body, 140),
                       m.created_at,
                       CASE WHEN m.repair_order_id IS NOT NULL
                            THEN '/app/repair-orders/' || m.repair_order_id
                            ELSE '/app/messages' END
                  FROM messages m
                  JOIN customers c ON c.id = m.customer_id
                 WHERE m.shop_id = $1
                   AND m.direction = 'inbound'
                   AND m.read_at IS NULL

                UNION ALL
                SELECT 'follow_up', f.id,
                       'Follow-up due: ' || coalesce(f.title, initcap(replace(f.kind, '_', ' '))),
                       concat_ws(' · ', c.full_name, f.details),
                       f.scheduled_for,
                       '/app/crm'
                  FROM follow_ups f
                  JOIN customers c ON c.id = f.customer_id
                 WHERE f.shop_id = $1
                   AND f.status = 'pending'
                   AND f.scheduled_for <= now()
              ) u
              ORDER BY u.at
              LIMIT 30
            ) t)                                                            AS attention,

         (SELECT coalesce(json_agg(t), '[]'::json)
            FROM (
              SELECT status, count(*)::int AS n
                FROM repair_orders
               WHERE shop_id = $1 AND status NOT IN ('closed', 'cancelled')
               GROUP BY status
            ) t)                                                            AS pipeline,

         -- Who is carrying what: open tickets per tech, and the book hours on
         -- them. Declined lines are left out — nobody is doing that work.
         (SELECT coalesce(json_agg(t ORDER BY t.full_name), '[]'::json)
            FROM (
              SELECT s.id, s.full_name, s.specialties,
                     count(ro.id)::int AS tickets,
                     coalesce(sum(l.hours), 0)::float8 AS hours
                FROM staff s
                LEFT JOIN repair_orders ro
                       ON ro.technician_id = s.id
                      AND ro.shop_id = $1
                      AND ro.status NOT IN ('closed', 'cancelled')
                LEFT JOIN LATERAL (
                       SELECT sum(quantity) AS hours
                         FROM repair_order_lines l
                        WHERE l.repair_order_id = ro.id
                          AND l.kind = 'labor'
                          AND l.approval <> 'declined') l ON true
               WHERE s.shop_id = $1 AND s.role = 'tech' AND s.disabled_at IS NULL
               GROUP BY s.id
            ) t)                                                            AS workload,

         (SELECT coalesce(json_agg(t ORDER BY t.created_at DESC), '[]'::json)
            FROM (
              SELECT e.id, e.kind, e.detail, e.actor, e.created_at,
                     st.full_name AS staff_name,
                     ro.id AS repair_order_id, ro.number AS ro_number
                FROM repair_order_events e
                JOIN repair_orders ro ON ro.id = e.repair_order_id
                LEFT JOIN staff st ON st.id = e.staff_id
               WHERE e.shop_id = $1
               ORDER BY e.created_at DESC
               LIMIT 10
            ) t)                                                            AS activity`,
      [shopId, timezone],
    ),
  ]);

  const s = scalars[0];
  const l = lists[0];
  const staff = Number(s.staff);

  return {
    metrics: {
      appointmentsToday: Number(s.appointments_today),
      openRepairOrders: Number(s.open_ros),
      needsApproval: Number(s.needs_approval),
      awaitingParts: Number(s.awaiting_parts),
      ready: Number(s.ready),
      unpaidCount: Number(s.unpaid_count),
      unpaidCents: Number(s.unpaid_cents),
      revenueMonthCents: Number(s.revenue_month_cents),
      paidInvoicesMonth: Number(s.paid_invoices_month),
    },
    setup: {
      staff,
      hasHours: s.has_hours,
      twilioNumber: s.twilio_number,
      // The checklist disappears once every step is done; the phone step
      // waits on carrier registration, so for now it is the one that keeps
      // the card on screen.
      complete: staff > 1 && s.has_hours && Boolean(s.twilio_number),
    },
    appointments: l.appointments,
    attention: l.attention,
    pipeline: l.pipeline,
    workload: l.workload,
    activity: l.activity,
  };
}

/** "Morning" until noon, "Afternoon" until five, then "Evening" — on the shop's clock. */
export function greetingFor(now: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now),
  );
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

/** "September", for the revenue card's caption. */
export function monthName(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long" }).format(now);
}
