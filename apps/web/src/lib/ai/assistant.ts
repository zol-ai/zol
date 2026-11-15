import "server-only";

import { z } from "zod";

import type { Queryable } from "../db";
import { formatDateTime, formatRelative, formatTime } from "../format";
import { formatCents } from "../money";
import { formatPhone } from "../phone";
import { longDate, shiftDate, zonedDate, zonedDayOfWeek } from "../schedule";
import {
  APPOINTMENT_STATUS_LABEL,
  ESTIMATE_STATUS_LABEL,
  INVOICE_STATUS_LABEL,
  PART_STATUS_LABEL,
  RO_STATUS_LABEL,
  type AppointmentStatus,
  type EstimateStatus,
  type InvoiceStatus,
  type PartStatus,
  type RoStatus,
} from "../statuses";
import { aiConfigured, structuredCompletion } from "./client";

/**
 * Ask ZOL.
 *
 * The owner types "what's waiting on approval?" and gets an answer from the
 * shop's own tables, with a button into the record. The design is a fixed
 * toolbox: ten SQL functions, every one scoped by shop_id, every one written
 * by hand. The model never writes SQL and never sees a table — it is asked
 * two much smaller questions, "which of these tools answer this?" and "put
 * these results into a sentence", and each answer is parsed against a zod
 * schema before it is trusted. Any link the model returns that a tool did
 * not produce is dropped.
 *
 * Without an OpenAI key (or when the call fails) a keyword router picks the
 * tools and each tool's own template writes the answer. That path is not a
 * degraded mode — it is what every question runs on locally and in tests —
 * and the screen says which one it got.
 */

// -----------------------------------------------------------------------------
// The toolbox
// -----------------------------------------------------------------------------

export const TOOL_NAMES = [
  "approvalsWaiting",
  "tomorrowsSchedule",
  "partsDelays",
  "technicianWorkload",
  "revenueSummary",
  "declinedOpen",
  "readyForPickup",
  "unpaidInvoices",
  "customerLookup",
  "ticketLookup",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const PERIODS = ["today", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];

export const toolArgsSchema = z.object({
  /** tomorrowsSchedule: days from today on the shop's calendar. 0 is today, 1 tomorrow. */
  dateOffset: z.number().int().min(-7).max(30).optional(),
  /** revenueSummary. */
  period: z.enum(PERIODS).optional(),
  /** customerLookup: a name, or any part of a phone number. */
  term: z.string().max(80).optional(),
  /** ticketLookup: the ticket number as printed, without the hash. */
  number: z.number().int().min(1).max(9_999_999).optional(),
});

export type ToolArgs = z.infer<typeof toolArgsSchema>;

export interface ToolCall {
  name: ToolName;
  args: ToolArgs;
}

/** What the model sees when choosing. Plain language on purpose. */
const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  approvalsWaiting:
    "Tickets waiting on the customer to approve an estimate, oldest first.",
  tomorrowsSchedule:
    "Appointments on one day. args.dateOffset: 0 = today, 1 = tomorrow, 2 = day after, up to 30; negative for past days.",
  partsDelays:
    "Parts still outstanding (needed, requested, ordered) and which of them are late against the supplier's promise.",
  technicianWorkload:
    "Each technician's open tickets and the book hours on them; who is busiest and who has room.",
  revenueSummary:
    "Money actually taken (succeeded payments) for args.period: today, week (since Monday) or month; plus what is still owed.",
  declinedOpen:
    "Work customers declined that is still open, with the dollar value and whether the reminder is due.",
  readyForPickup:
    "Cars finished and waiting for the customer to collect them, with invoice state.",
  unpaidInvoices: "Invoices that are open or part paid, with the balance owing and due date.",
  customerLookup:
    "Find a customer by args.term (a name, or digits from a phone number): contact details, vehicles, open tickets, last visit.",
  ticketLookup:
    "Everything about one repair order by args.number: status, technician, totals, estimate, invoice, parts, last event.",
};

export interface AssistantLink {
  label: string;
  href: string;
}

export interface AssistantContext {
  shopId: string;
  shopName: string;
  timezone: string;
  /** Injectable for tests; defaults to the wall clock. */
  now?: Date;
}

/** One tool's answer: facts for the model, a sentence for the fallback, links for both. */
export interface ToolResult {
  name: ToolName;
  args: ToolArgs;
  /** Template answer in shop language. What the screen shows without a model. */
  text: string;
  links: AssistantLink[];
  /** The rows, for the model to compose from. Never shown raw. */
  data: unknown;
  /** Set when the tool itself failed; text then says so. */
  failed?: boolean;
}

export interface AssistantReply {
  answer: string;
  links: AssistantLink[];
  source: "openai" | "fallback";
  model?: string;
  tools: ToolName[];
}

/** The chips on the empty screen. Each one routes cleanly through the keyword router. */
export const SUGGESTED_QUESTIONS: readonly string[] = [
  "What's waiting on approval?",
  "What's on the schedule tomorrow?",
  "Any parts running late?",
  "How busy are the techs?",
  "How much revenue this month?",
  "What declined work is still open?",
  "Which cars are ready for pickup?",
  "Who still owes us money?",
];

const MAX_TOOLS = 3;
const LIST_LIMIT = 12;

// -----------------------------------------------------------------------------
// Small helpers the templates share
// -----------------------------------------------------------------------------

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function who(name: string | null, vehicle: string | null): string {
  return [name ?? "Unnamed customer", vehicle].filter(Boolean).join(", ");
}

function ticketLink(id: string, number: number): AssistantLink {
  return { label: `Open ticket #${number}`, href: `/app/repair-orders/${id}` };
}

function dedupeLinks(links: AssistantLink[], max = 6): AssistantLink[] {
  const seen = new Set<string>();
  const out: AssistantLink[] = [];
  for (const link of links) {
    if (seen.has(link.href)) continue;
    seen.add(link.href);
    out.push(link);
    if (out.length >= max) break;
  }
  return out;
}

function vehicleSql(alias = "v"): string {
  return `nullif(concat_ws(' ', ${alias}.year::text, ${alias}.make, ${alias}.model), '')`;
}

// -----------------------------------------------------------------------------
// Tools
// -----------------------------------------------------------------------------

type Tool = (client: Queryable, ctx: AssistantContext, args: ToolArgs) => Promise<ToolResult>;

const approvalsWaiting: Tool = async (client, ctx) => {
  const { rows } = await client.query<{
    id: string;
    number: number;
    status: RoStatus;
    total_cents: number;
    customer: string | null;
    vehicle: string | null;
    estimate_number: number | null;
    estimate_status: EstimateStatus | null;
    estimate_total: number | null;
    sent_at: string | null;
    viewed_at: string | null;
    waiting_since: string;
  }>(
    `SELECT ro.id, ro.number, ro.status, ro.total_cents,
            c.full_name AS customer, ${vehicleSql()} AS vehicle,
            e.number AS estimate_number, e.status AS estimate_status,
            e.total_cents AS estimate_total, e.sent_at::text, e.viewed_at::text,
            coalesce(e.sent_at, ro.updated_at)::text AS waiting_since
       FROM repair_orders ro
       JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
       LEFT JOIN LATERAL (
              SELECT e.number, e.status, e.total_cents, e.sent_at, e.viewed_at
                FROM estimates e
               WHERE e.repair_order_id = ro.id AND e.status IN ('sent', 'viewed')
               ORDER BY e.created_at DESC LIMIT 1) e ON true
      WHERE ro.shop_id = $1
        AND ro.status NOT IN ('closed', 'cancelled')
        AND (ro.status = 'awaiting_approval' OR e.number IS NOT NULL)
      ORDER BY coalesce(e.sent_at, ro.updated_at)
      LIMIT $2`,
    [ctx.shopId, LIST_LIMIT],
  );

  const now = ctx.now ?? new Date();
  const lines = rows.map((r) => {
    const est = r.estimate_number
      ? `estimate #${r.estimate_number} ${
          r.viewed_at ? `opened ${formatRelative(r.viewed_at, ctx.timezone, now)}` : "not opened yet"
        }`
      : "no estimate sent yet";
    const total = r.estimate_total ?? r.total_cents;
    return `• #${r.number} — ${who(r.customer, r.vehicle)} — ${formatCents(total)}, ${est}, waiting ${formatRelative(r.waiting_since, ctx.timezone, now).replace(" ago", "")}.`;
  });

  return {
    name: "approvalsWaiting",
    args: {},
    text:
      rows.length === 0
        ? "Nothing is waiting on a customer's approval right now."
        : `${plural(rows.length, "ticket is", "tickets are")} waiting on the customer:\n${lines.join("\n")}`,
    links: dedupeLinks([
      ...rows.slice(0, 4).map((r) => ticketLink(r.id, r.number)),
      { label: "All estimates", href: "/app/estimates" },
    ]),
    data: rows,
  };
};

const tomorrowsSchedule: Tool = async (client, ctx, args) => {
  const offset = args.dateOffset ?? 1;
  const now = ctx.now ?? new Date();
  const date = shiftDate(zonedDate(now, ctx.timezone), offset);

  const { rows } = await client.query<{
    id: string;
    starts_at: string;
    status: AppointmentStatus;
    service_type: string | null;
    complaint: string | null;
    customer: string | null;
    vehicle: string | null;
    technician: string | null;
    bay: number | null;
    booked_by_agent: boolean;
    repair_order_id: string | null;
    ro_number: number | null;
  }>(
    `SELECT a.id, a.starts_at::text, a.status, a.service_type, a.complaint,
            c.full_name AS customer, ${vehicleSql()} AS vehicle,
            s.full_name AS technician, a.bay, a.booked_by_agent,
            a.repair_order_id, ro.number AS ro_number
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       LEFT JOIN staff s ON s.id = a.technician_id
       LEFT JOIN repair_orders ro ON ro.id = a.repair_order_id
      WHERE a.shop_id = $1
        AND a.status <> 'cancelled'
        AND (a.starts_at AT TIME ZONE $3)::date = $2::date
      ORDER BY a.starts_at, a.bay NULLS LAST`,
    [ctx.shopId, date, ctx.timezone],
  );

  const dayName =
    offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday" : longDate(date, ctx.timezone);
  const heading = offset === 0 || offset === 1 || offset === -1 ? `${dayName} (${longDate(date, ctx.timezone)})` : dayName;

  const lines = rows.map(
    (r) =>
      `• ${formatTime(r.starts_at, ctx.timezone)} — ${who(r.customer, r.vehicle)} — ${
        r.service_type ?? r.complaint ?? "appointment"
      }${r.technician ? ` with ${r.technician}` : ""}${r.bay ? `, bay ${r.bay}` : ""} (${APPOINTMENT_STATUS_LABEL[r.status] ?? r.status}${
        r.booked_by_agent ? ", booked by ZOL" : ""
      }${r.ro_number ? `, ticket #${r.ro_number}` : ""}).`,
  );

  return {
    name: "tomorrowsSchedule",
    args: { dateOffset: offset },
    text:
      rows.length === 0
        ? `${heading}: nothing in the book.`
        : `${heading} has ${plural(rows.length, "appointment")}:\n${lines.join("\n")}`,
    links: dedupeLinks([
      { label: `Open ${offset === 0 ? "today's" : offset === 1 ? "tomorrow's" : "that day's"} schedule`, href: `/app/schedule?date=${date}` },
      ...rows.filter((r) => r.repair_order_id).slice(0, 3).map((r) => ticketLink(r.repair_order_id!, r.ro_number!)),
    ]),
    data: { date, appointments: rows },
  };
};

const partsDelays: Tool = async (client, ctx) => {
  const { rows } = await client.query<{
    id: string;
    name: string;
    supplier: string | null;
    status: PartStatus;
    quantity: number;
    expected_at: string | null;
    late: boolean;
    repair_order_id: string;
    ro_number: number;
    customer: string | null;
    vehicle: string | null;
  }>(
    `SELECT p.id, p.name, p.supplier, p.status, p.quantity, p.expected_at::text,
            (p.expected_at IS NOT NULL AND p.expected_at < now()) AS late,
            ro.id AS repair_order_id, ro.number AS ro_number,
            c.full_name AS customer, ${vehicleSql()} AS vehicle
       FROM parts p
       JOIN repair_orders ro ON ro.id = p.repair_order_id
       JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      WHERE p.shop_id = $1
        AND p.status IN ('needed', 'requested', 'ordered')
      ORDER BY (p.expected_at IS NOT NULL AND p.expected_at < now()) DESC,
               p.expected_at NULLS LAST, p.created_at
      LIMIT $2`,
    [ctx.shopId, LIST_LIMIT],
  );

  const late = rows.filter((r) => r.late);
  const lines = rows.map(
    (r) =>
      `• ${r.late ? "LATE — " : ""}${r.name}${r.quantity > 1 ? ` ×${r.quantity}` : ""}${
        r.supplier ? ` (${r.supplier})` : ""
      } for #${r.ro_number}, ${who(r.customer, r.vehicle)} — ${PART_STATUS_LABEL[r.status] ?? r.status}${
        r.expected_at ? `, expected ${formatDateTime(r.expected_at, ctx.timezone)}` : ", no ETA"
      }.`,
  );

  const summary =
    rows.length === 0
      ? "No parts are outstanding — nothing is holding a bay."
      : late.length === 0
        ? `No parts are late. ${plural(rows.length, "part is", "parts are")} still on the way:\n${lines.join("\n")}`
        : `${plural(late.length, "part is", "parts are")} late${
            rows.length > late.length ? `, ${rows.length - late.length} more on the way` : ""
          }:\n${lines.join("\n")}`;

  return {
    name: "partsDelays",
    args: {},
    text: summary,
    links: dedupeLinks([
      ...rows.slice(0, 3).map((r) => ticketLink(r.repair_order_id, r.ro_number)),
      { label: "Parts", href: "/app/parts" },
    ]),
    data: rows,
  };
};

const technicianWorkload: Tool = async (client, ctx) => {
  const { rows } = await client.query<{
    id: string;
    full_name: string;
    specialties: string[];
    tickets: number;
    hours: number;
    ticket_numbers: number[];
  }>(
    `SELECT s.id, s.full_name, s.specialties,
            count(ro.id)::int AS tickets,
            coalesce(sum(l.hours), 0)::float8 AS hours,
            coalesce(array_agg(ro.number ORDER BY ro.number) FILTER (WHERE ro.id IS NOT NULL), '{}') AS ticket_numbers
       FROM staff s
       LEFT JOIN repair_orders ro
              ON ro.technician_id = s.id AND ro.shop_id = $1
             AND ro.status NOT IN ('closed', 'cancelled')
       LEFT JOIN LATERAL (
              SELECT sum(quantity) AS hours
                FROM repair_order_lines l
               WHERE l.repair_order_id = ro.id AND l.kind = 'labor' AND l.approval <> 'declined') l ON true
      WHERE s.shop_id = $1 AND s.role = 'tech' AND s.disabled_at IS NULL
      GROUP BY s.id
      ORDER BY hours DESC, s.full_name`,
    [ctx.shopId],
  );

  const lines = rows.map(
    (r) =>
      `• ${r.full_name}: ${plural(r.tickets, "open ticket")}, ${r.hours.toFixed(1)} book hours${
        r.ticket_numbers.length > 0 ? ` (${r.ticket_numbers.map((n) => `#${n}`).join(", ")})` : ""
      }${r.specialties.length > 0 ? ` — ${r.specialties.join(", ")}` : ""}.`,
  );
  const lightest = rows.length > 1 ? rows[rows.length - 1] : null;

  return {
    name: "technicianWorkload",
    args: {},
    text:
      rows.length === 0
        ? "There are no technicians on the team yet."
        : `${lines.join("\n")}${lightest ? `\nLightest load: ${lightest.full_name}.` : ""}`,
    links: [{ label: "Technician board", href: "/app/technicians" }],
    data: rows,
  };
};

const revenueSummary: Tool = async (client, ctx, args) => {
  const period: Period = args.period ?? "month";
  const { rows } = await client.query<{
    cents: string;
    payments: number;
    invoices: number;
    card_cents: string;
    cash_cents: string;
    owed_cents: string;
    owed_count: number;
  }>(
    `WITH bounds AS (
       SELECT CASE $2
                WHEN 'today' THEN (now() AT TIME ZONE $3)::date::timestamp
                WHEN 'week'  THEN date_trunc('week', now() AT TIME ZONE $3)
                ELSE date_trunc('month', now() AT TIME ZONE $3)
              END AS start_local
     ),
     taken AS (
       SELECT p.amount_cents, p.method, p.invoice_id
         FROM payments p, bounds
        WHERE p.shop_id = $1 AND p.status = 'succeeded'
          AND (coalesce(p.processed_at, p.created_at) AT TIME ZONE $3) >= bounds.start_local
     )
     SELECT coalesce(sum(amount_cents), 0)::bigint AS cents,
            count(*)::int AS payments,
            count(DISTINCT invoice_id)::int AS invoices,
            coalesce(sum(amount_cents) FILTER (WHERE method = 'card'), 0)::bigint AS card_cents,
            coalesce(sum(amount_cents) FILTER (WHERE method IN ('cash', 'check')), 0)::bigint AS cash_cents,
            (SELECT coalesce(sum(total_cents - paid_cents), 0)::bigint FROM invoices
              WHERE shop_id = $1 AND status IN ('open', 'partial')) AS owed_cents,
            (SELECT count(*)::int FROM invoices
              WHERE shop_id = $1 AND status IN ('open', 'partial')) AS owed_count
       FROM taken`,
    [ctx.shopId, period, ctx.timezone],
  );

  const r = rows[0];
  const cents = Number(r.cents);
  const label = period === "today" ? "Today" : period === "week" ? "This week (since Monday)" : "This month";
  const average = r.invoices > 0 ? Math.round(cents / r.invoices) : null;

  const text =
    cents === 0
      ? `${label}: no payments taken yet. ${
          r.owed_count > 0
            ? `${formatCents(Number(r.owed_cents))} is still owed on ${plural(r.owed_count, "open invoice")}.`
            : "Nothing is owed on open invoices."
        }`
      : `${label}: ${formatCents(cents)} taken across ${plural(r.invoices, "paid invoice")}${
          average !== null ? ` (average ticket ${formatCents(average)})` : ""
        } — card ${formatCents(Number(r.card_cents))}, cash and cheque ${formatCents(Number(r.cash_cents))}. ${
          r.owed_count > 0
            ? `Still owed: ${formatCents(Number(r.owed_cents))} on ${plural(r.owed_count, "open invoice")}.`
            : "Nothing is owed on open invoices."
        }`;

  return {
    name: "revenueSummary",
    args: { period },
    text,
    links: [
      { label: "Payments", href: "/app/payments" },
      { label: "Invoices", href: "/app/invoices" },
    ],
    data: { period, ...r },
  };
};

const declinedOpen: Tool = async (client, ctx) => {
  const { rows } = await client.query<{
    id: string;
    description: string;
    estimated_cents: number | null;
    declined_at: string;
    due: boolean;
    customer_id: string;
    customer: string | null;
    vehicle: string | null;
    sms_opted_out: boolean;
  }>(
    `SELECT d.id, d.description, d.estimated_cents, d.declined_at::text,
            (d.remind_after IS NOT NULL AND d.remind_after <= now() AND d.reminded_at IS NULL) AS due,
            d.customer_id, c.full_name AS customer, ${vehicleSql()} AS vehicle, c.sms_opted_out
       FROM declined_work d
       JOIN customers c ON c.id = d.customer_id
       LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.shop_id = $1 AND d.resolved_at IS NULL
      ORDER BY (d.remind_after IS NOT NULL AND d.remind_after <= now() AND d.reminded_at IS NULL) DESC,
               d.declined_at DESC
      LIMIT $2`,
    [ctx.shopId, LIST_LIMIT],
  );

  const now = ctx.now ?? new Date();
  const total = rows.reduce((sum, r) => sum + (r.estimated_cents ?? 0), 0);
  const due = rows.filter((r) => r.due).length;
  const lines = rows.map(
    (r) =>
      `• ${r.description} — ${who(r.customer, r.vehicle)}${
        r.estimated_cents != null ? ` — ${formatCents(r.estimated_cents)}` : ""
      }, declined ${formatRelative(r.declined_at, ctx.timezone, now)}${r.due ? ", due to raise now" : ""}${
        r.sms_opted_out ? " (no texts — call them)" : ""
      }.`,
  );

  return {
    name: "declinedOpen",
    args: {},
    text:
      rows.length === 0
        ? "No declined work is open."
        : `${plural(rows.length, "item")} of declined work open, worth ${formatCents(total)}${
            due > 0 ? `, ${due} due to bring up now` : ""
          }:\n${lines.join("\n")}`,
    links: dedupeLinks([
      { label: "Declined work", href: "/app/declined" },
      ...rows.slice(0, 3).map((r) => ({
        label: `Open ${r.customer ?? "customer"}`,
        href: `/app/customers/${r.customer_id}`,
      })),
    ]),
    data: rows,
  };
};

const readyForPickup: Tool = async (client, ctx) => {
  const { rows } = await client.query<{
    id: string;
    number: number;
    total_cents: number;
    completed_at: string | null;
    customer: string | null;
    phone: string;
    vehicle: string | null;
    invoice_number: number | null;
    invoice_status: InvoiceStatus | null;
    balance_cents: number | null;
  }>(
    `SELECT ro.id, ro.number, ro.total_cents, ro.completed_at::text,
            c.full_name AS customer, c.phone, ${vehicleSql()} AS vehicle,
            i.number AS invoice_number, i.status AS invoice_status,
            (i.total_cents - i.paid_cents) AS balance_cents
       FROM repair_orders ro
       JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
       LEFT JOIN invoices i ON i.repair_order_id = ro.id
      WHERE ro.shop_id = $1 AND ro.status = 'ready'
      ORDER BY ro.completed_at NULLS LAST, ro.updated_at
      LIMIT $2`,
    [ctx.shopId, LIST_LIMIT],
  );

  const now = ctx.now ?? new Date();
  const lines = rows.map(
    (r) =>
      `• #${r.number} — ${who(r.customer, r.vehicle)}, ${formatPhone(r.phone)} — ${formatCents(
        r.total_cents,
      )}${
        r.invoice_number
          ? `, invoice #${r.invoice_number} ${(INVOICE_STATUS_LABEL[r.invoice_status!] ?? r.invoice_status ?? "").toLowerCase()}`
          : ", no invoice yet"
      }${r.completed_at ? `, ready ${formatRelative(r.completed_at, ctx.timezone, now)}` : ""}.`,
  );

  return {
    name: "readyForPickup",
    args: {},
    text:
      rows.length === 0
        ? "No cars are waiting to be picked up."
        : `${plural(rows.length, "car is", "cars are")} ready to go:\n${lines.join("\n")}`,
    links: dedupeLinks([
      ...rows.slice(0, 4).map((r) => ticketLink(r.id, r.number)),
      { label: "Ready column", href: "/app/repair-orders?status=ready" },
    ]),
    data: rows,
  };
};

const unpaidInvoices: Tool = async (client, ctx) => {
  const { rows } = await client.query<{
    id: string;
    number: number;
    status: InvoiceStatus;
    total_cents: number;
    paid_cents: number;
    due_at: string | null;
    customer: string | null;
    phone: string;
    repair_order_id: string;
    ro_number: number;
  }>(
    `SELECT i.id, i.number, i.status, i.total_cents, i.paid_cents, i.due_at::text,
            c.full_name AS customer, c.phone, i.repair_order_id, ro.number AS ro_number
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       JOIN repair_orders ro ON ro.id = i.repair_order_id
      WHERE i.shop_id = $1 AND i.status IN ('open', 'partial')
      ORDER BY i.due_at NULLS LAST, i.created_at
      LIMIT $2`,
    [ctx.shopId, LIST_LIMIT],
  );

  const owed = rows.reduce((sum, r) => sum + (r.total_cents - r.paid_cents), 0);
  const now = ctx.now ?? new Date();
  const lines = rows.map((r) => {
    const balance = r.total_cents - r.paid_cents;
    const due = r.due_at
      ? new Date(r.due_at) < now
        ? `overdue since ${formatDateTime(r.due_at, ctx.timezone)}`
        : `due ${formatDateTime(r.due_at, ctx.timezone)}`
      : "no due date";
    return `• #${r.number} — ${r.customer ?? "Unnamed"}, ${formatPhone(r.phone)} — ${formatCents(balance)} owing${
      r.status === "partial" ? ` of ${formatCents(r.total_cents)}` : ""
    }, ${due} (ticket #${r.ro_number}).`;
  });

  return {
    name: "unpaidInvoices",
    args: {},
    text:
      rows.length === 0
        ? "Every invoice is paid. Nothing is owed."
        : `${plural(rows.length, "invoice is", "invoices are")} unpaid, ${formatCents(owed)} owing in total:\n${lines.join("\n")}`,
    links: dedupeLinks([
      { label: "Invoices", href: "/app/invoices" },
      ...rows.slice(0, 3).map((r) => ticketLink(r.repair_order_id, r.ro_number)),
    ]),
    data: rows,
  };
};

const customerLookup: Tool = async (client, ctx, args) => {
  const term = (args.term ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (term.length < 2) {
    return {
      name: "customerLookup",
      args: { term },
      text: "Which customer? Give me a name or part of a phone number.",
      links: [{ label: "Customers", href: "/app/customers" }],
      data: [],
    };
  }

  const words = term.split(" ").map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const digitsOnly = term.replace(/\D/g, "");
  const digits = digitsOnly.length >= 3 ? digitsOnly : "";

  const { rows } = await client.query<{
    id: string;
    full_name: string | null;
    phone: string;
    email: string | null;
    sms_opted_out: boolean;
    vehicles: string[];
    open_tickets: { id: string; number: number; status: RoStatus }[];
    last_visit: string | null;
  }>(
    `SELECT c.id, c.full_name, c.phone, c.email, c.sms_opted_out,
            coalesce((SELECT array_agg(concat_ws(' ', v.year::text, v.make, v.model)
                                       || CASE WHEN v.plate IS NOT NULL THEN ' (' || v.plate || ')' ELSE '' END
                                       ORDER BY v.created_at DESC)
                        FROM vehicles v WHERE v.customer_id = c.id), '{}') AS vehicles,
            coalesce((SELECT json_agg(json_build_object('id', ro.id, 'number', ro.number, 'status', ro.status)
                                      ORDER BY ro.created_at DESC)
                        FROM repair_orders ro
                       WHERE ro.customer_id = c.id AND ro.status NOT IN ('closed', 'cancelled')), '[]'::json) AS open_tickets,
            (SELECT max(ro.created_at) FROM repair_orders ro WHERE ro.customer_id = c.id)::text AS last_visit
       FROM customers c
      WHERE c.shop_id = $1
        AND (c.full_name ILIKE ALL ($2::text[])
             OR ($3 <> '' AND c.phone LIKE '%' || $3 || '%'))
      ORDER BY ($3 <> '' AND c.phone LIKE '%' || $3 || '%') DESC, c.full_name
      LIMIT 3`,
    [ctx.shopId, words, digits],
  );

  const now = ctx.now ?? new Date();
  const blocks = rows.map((r) => {
    const tickets =
      r.open_tickets.length === 0
        ? "no open tickets"
        : `${plural(r.open_tickets.length, "open ticket")}: ${r.open_tickets
            .map((t) => `#${t.number} (${RO_STATUS_LABEL[t.status] ?? t.status})`)
            .join(", ")}`;
    return `${r.full_name ?? "Unnamed"} — ${formatPhone(r.phone)}${r.email ? `, ${r.email}` : ""}${
      r.sms_opted_out ? " (texts stopped — call them)" : ""
    }. Vehicles: ${r.vehicles.length > 0 ? r.vehicles.join("; ") : "none on file"}. ${
      tickets.charAt(0).toUpperCase() + tickets.slice(1)
    }. Last visit: ${r.last_visit ? formatRelative(r.last_visit, ctx.timezone, now) : "no tickets yet"}.`;
  });

  return {
    name: "customerLookup",
    args: { term },
    text:
      rows.length === 0
        ? `No customer at ${ctx.shopName} matches “${term}”.`
        : blocks.join("\n\n"),
    links: dedupeLinks([
      ...rows.map((r) => ({ label: `Open ${r.full_name ?? "customer"}`, href: `/app/customers/${r.id}` })),
      ...rows.flatMap((r) => r.open_tickets.slice(0, 2).map((t) => ticketLink(t.id, t.number))),
      ...(rows.length === 0 ? [{ label: "Search everything", href: `/app/search?q=${encodeURIComponent(term)}` }] : []),
    ]),
    data: rows,
  };
};

const ticketLookup: Tool = async (client, ctx, args) => {
  const number = args.number;
  if (!number) {
    return {
      name: "ticketLookup",
      args: {},
      text: "Which ticket? Give me the number, like #1047.",
      links: [{ label: "Repair orders", href: "/app/repair-orders" }],
      data: null,
    };
  }

  const { rows } = await client.query<{
    id: string;
    number: number;
    status: RoStatus;
    priority: string;
    complaint: string | null;
    cause: string | null;
    total_cents: number;
    created_at: string;
    promised_at: string | null;
    customer_id: string;
    customer: string | null;
    phone: string;
    vehicle: string | null;
    technician: string | null;
    lines: number;
    pending_lines: number;
    estimate_number: number | null;
    estimate_status: EstimateStatus | null;
    invoice_number: number | null;
    invoice_status: InvoiceStatus | null;
    balance_cents: number | null;
    parts_outstanding: number;
    last_event: string | null;
    last_event_at: string | null;
  }>(
    `SELECT ro.id, ro.number, ro.status, ro.priority, ro.complaint, ro.cause, ro.total_cents,
            ro.created_at::text, ro.promised_at::text,
            ro.customer_id, c.full_name AS customer, c.phone, ${vehicleSql()} AS vehicle,
            s.full_name AS technician,
            (SELECT count(*)::int FROM repair_order_lines l WHERE l.repair_order_id = ro.id) AS lines,
            (SELECT count(*)::int FROM repair_order_lines l
              WHERE l.repair_order_id = ro.id AND l.approval = 'pending') AS pending_lines,
            e.number AS estimate_number, e.status AS estimate_status,
            i.number AS invoice_number, i.status AS invoice_status,
            (i.total_cents - i.paid_cents) AS balance_cents,
            (SELECT count(*)::int FROM parts p
              WHERE p.repair_order_id = ro.id AND p.status IN ('needed', 'requested', 'ordered')) AS parts_outstanding,
            ev.detail AS last_event, ev.created_at::text AS last_event_at
       FROM repair_orders ro
       JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
       LEFT JOIN staff s ON s.id = ro.technician_id
       LEFT JOIN LATERAL (SELECT number, status FROM estimates e
                           WHERE e.repair_order_id = ro.id ORDER BY e.created_at DESC LIMIT 1) e ON true
       LEFT JOIN invoices i ON i.repair_order_id = ro.id
       LEFT JOIN LATERAL (SELECT detail, created_at FROM repair_order_events ev
                           WHERE ev.repair_order_id = ro.id ORDER BY ev.created_at DESC LIMIT 1) ev ON true
      WHERE ro.shop_id = $1 AND ro.number = $2`,
    [ctx.shopId, number],
  );

  const r = rows[0];
  if (!r) {
    return {
      name: "ticketLookup",
      args: { number },
      text: `There's no ticket #${number} at ${ctx.shopName}.`,
      links: [{ label: "Repair orders", href: "/app/repair-orders" }],
      data: null,
    };
  }

  const now = ctx.now ?? new Date();
  const parts: string[] = [
    `#${r.number} — ${who(r.customer, r.vehicle)} — ${RO_STATUS_LABEL[r.status] ?? r.status}${
      r.technician ? `, with ${r.technician}` : ", unassigned"
    }${r.priority !== "normal" ? `, ${r.priority} priority` : ""}. Opened ${formatRelative(r.created_at, ctx.timezone, now)}.`,
  ];
  if (r.complaint) parts.push(`Complaint: ${r.complaint}`);
  if (r.cause) parts.push(`Cause: ${r.cause}`);
  parts.push(
    `Total ${formatCents(r.total_cents)} across ${plural(r.lines, "line")}${
      r.pending_lines > 0 ? ` (${r.pending_lines} awaiting the customer)` : ""
    }.`,
  );
  if (r.estimate_number) {
    parts.push(`Estimate #${r.estimate_number}: ${ESTIMATE_STATUS_LABEL[r.estimate_status!] ?? r.estimate_status}.`);
  }
  if (r.invoice_number) {
    parts.push(
      `Invoice #${r.invoice_number}: ${INVOICE_STATUS_LABEL[r.invoice_status!] ?? r.invoice_status}${
        (r.balance_cents ?? 0) > 0 ? `, ${formatCents(r.balance_cents!)} owing` : ""
      }.`,
    );
  }
  if (r.parts_outstanding > 0) parts.push(`${plural(r.parts_outstanding, "part")} still outstanding.`);
  if (r.promised_at) parts.push(`Promised for ${formatDateTime(r.promised_at, ctx.timezone)}.`);
  if (r.last_event) parts.push(`Last: ${r.last_event} (${formatRelative(r.last_event_at!, ctx.timezone, now)}).`);

  return {
    name: "ticketLookup",
    args: { number },
    text: parts.join(" "),
    links: [
      ticketLink(r.id, r.number),
      { label: `Open ${r.customer ?? "customer"}`, href: `/app/customers/${r.customer_id}` },
    ],
    data: r,
  };
};

const TOOLS: Record<ToolName, Tool> = {
  approvalsWaiting,
  tomorrowsSchedule,
  partsDelays,
  technicianWorkload,
  revenueSummary,
  declinedOpen,
  readyForPickup,
  unpaidInvoices,
  customerLookup,
  ticketLookup,
};

// -----------------------------------------------------------------------------
// The keyword router — what runs without a model
// -----------------------------------------------------------------------------

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Words that carry no lookup meaning when somebody asks about a customer:
 * "find me Jordan Lee's number" should search for "Jordan Lee".
 */
const LOOKUP_NOISE =
  /\b(find|look\s?up|lookup|show|get|pull\s?up|search|me|the|a|an|for|of|customer|customers|client|details|info|information|history|record|file|phone|number|email|address|who|is|what|whats|what's|about|please|can|you|do|we|have|on|up|his|her|their)\b/gi;

/**
 * "money" on its own is not a revenue question — "who owes us money" is the
 * unpaid list — so this wants a verb of taking or a noun of income. Shared
 * with the schedule rule so "how much did we take today" is not also a
 * question about today's bookings.
 */
const REVENUE =
  /\b(revenue|sales|income|earn\w*|turnover|took|taken|take|bring|brought|make|made|payments?|numbers)\b/;

export interface RouterContext {
  /** 0 = Sunday, as the shop's calendar reads today. Lets "on Friday" become an offset. */
  todayDow: number;
}

/**
 * Decide which tools a question needs, without a model. Deliberately
 * generous: a question that touches two things runs two tools, and the
 * templates answer both. Returns an empty list when nothing fits, which the
 * screen turns into a "here's what I can answer" reply rather than a guess.
 */
export function routeByKeywords(question: string, ctx: RouterContext): ToolCall[] {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  // "repair orders" and "unpaid" would otherwise trip the parts and
  // revenue rules; strip them before matching and remember what was there.
  const stripped = q.replace(/repair orders?/g, "tickets").replace(/\bunpaid\b/g, "owing");
  const calls: ToolCall[] = [];
  const add = (name: ToolName, args: ToolArgs = {}) => {
    if (!calls.some((c) => c.name === name)) calls.push({ name, args });
  };

  // A phone number anywhere is a customer.
  const phone = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(question);
  if (phone) add("customerLookup", { term: phone[0].replace(/\D/g, "") });

  // "#1047", "ticket 1047", or a bare four-to-seven digit number.
  const ticket =
    /(?:#|\bticket\s*#?|\bro\s*#?|\bjob\s*#?|\border\s*#?)\s*(\d{1,7})\b/i.exec(question) ??
    (!phone ? /(?:^|\s)(\d{4,7})(?:\s|$|\?)/.exec(question) : null);
  if (ticket) add("ticketLookup", { number: Number(ticket[1]) });

  // When.
  let offset: number | null = null;
  if (/day after tomorrow/.test(stripped)) offset = 2;
  else if (/\btomorrow\b/.test(stripped)) offset = 1;
  else if (/\byesterday\b/.test(stripped)) offset = -1;
  else if (/\b(today|this morning|this afternoon|tonight|right now)\b/.test(stripped)) offset = 0;
  else {
    const day = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b`).test(stripped));
    if (day >= 0) offset = (day - ctx.todayDow + 7) % 7;
  }

  const schedule = /\b(schedule|book(ed|ings?)?|appointments?|coming in|calendar|what's on|whats on|on the books|slots?|bays? (free|open)|arriv)/.test(
    stripped,
  );
  if (schedule || (offset !== null && !REVENUE.test(stripped))) {
    add("tomorrowsSchedule", { dateOffset: offset ?? 1 });
  }

  if (/\b(approv|waiting on (the )?customer|unanswered|estimates?|quotes?|sign[- ]?off|authori[sz])/.test(stripped)) {
    add("approvalsWaiting");
  }

  if (/\b(parts?|delay\w*|late|back[- ]?order\w*|supplier|eta|on order|ordered|shipment)\b/.test(stripped)) {
    add("partsDelays");
  }

  if (/\b(techs?|technicians?|workload|capacity|busy|who('s| is) (free|working|on what|doing)|assigned|bandwidth)\b/.test(stripped)) {
    add("technicianWorkload");
  }

  if (/\b(declin\w*|said no|turned down|recall\w*)\b/.test(stripped)) {
    add("declinedOpen");
  }

  if (/\b(ready|pick[- ]?up|finished|done|completed|collect\w*|waiting (for|on) pickup)\b/.test(stripped) && !/\bnot ready\b/.test(stripped)) {
    add("readyForPickup");
  }

  if (/\b(owing|owe|owes|outstanding|balance|overdue|collections?|hasn'?t paid|not paid|invoices?|receivable)\b/.test(stripped)) {
    add("unpaidInvoices");
  }

  if (REVENUE.test(stripped)) {
    const period: Period = /\btoday\b/.test(stripped)
      ? "today"
      : /\bweek\b/.test(stripped)
        ? "week"
        : "month";
    add("revenueSummary", { period });
  }

  // A customer by name: an explicit ask, or a capitalised name mid-sentence
  // when nothing else matched.
  if (!phone) {
    // Possessives come off first: "Priya Shah's number" is about Priya Shah.
    const plain = question.replace(/['’]s\b/g, "");
    const asked = /\b(customer|client|find|look\s?up|lookup|who is|who's|phone|email|address|history|details|file on)\b/i.test(plain);
    const named = /(?:^|[\s,])([A-Z][a-z]+(?:\s+[A-Z][a-z-]+)+)/.exec(plain.replace(/^[A-Z][a-z]+\s/, ""));
    if (asked) {
      const term = plain
        .replace(LOOKUP_NOISE, " ")
        .replace(/[?!.,'’]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (term.length >= 2 && !/^\d+$/.test(term)) add("customerLookup", { term });
    } else if (named && calls.length === 0) {
      add("customerLookup", { term: named[1].trim() });
    }
  }

  return calls.slice(0, MAX_TOOLS);
}

// -----------------------------------------------------------------------------
// Composition
// -----------------------------------------------------------------------------

/** The template answer: each tool's sentence, in the order the tools ran. */
export function composeFallback(results: ToolResult[]): { answer: string; links: AssistantLink[] } {
  return {
    answer: results.map((r) => r.text).join("\n\n"),
    links: dedupeLinks(results.flatMap((r) => r.links)),
  };
}

/**
 * Only links a tool produced may reach the screen. The model may pick
 * which of them to show and relabel them, but it cannot mint a URL — a
 * hallucinated /app/customers/<uuid> is worse than no button.
 */
export function allowedLinks(
  proposed: AssistantLink[],
  results: ToolResult[],
): AssistantLink[] {
  const byHref = new Map(results.flatMap((r) => r.links).map((l) => [l.href, l]));
  return dedupeLinks(
    proposed
      .filter((l) => byHref.has(l.href))
      .map((l) => ({ href: l.href, label: l.label.trim() || byHref.get(l.href)!.label })),
  );
}

export function helpReply(shopName: string): AssistantReply {
  return {
    answer:
      `I answer questions from ${shopName}'s own records: what's waiting on approval, the schedule for any day, ` +
      "parts that are late, how loaded each technician is, revenue for today, this week or this month, declined work, " +
      "cars ready for pickup, unpaid invoices, and anything about one customer or one ticket number. Try one of the suggestions below.",
    links: [],
    source: "fallback",
    tools: [],
  };
}

const routeSchema = z.object({
  tools: z
    .array(z.object({ name: z.enum(TOOL_NAMES), args: toolArgsSchema }))
    .max(MAX_TOOLS),
});

const answerSchema = z.object({
  answer: z.string().min(1).max(1500),
  links: z.array(z.object({ label: z.string().max(60), href: z.string().max(200) })).max(6),
});

export interface Turn {
  question: string;
  answer: string;
}

/**
 * Answer one question. Two model calls when a key is configured — route,
 * then compose — each falling back to the deterministic path on its own,
 * so a model that picks tools but fails to write the sentence still gets a
 * templated answer built from the same rows.
 */
export async function answerQuestion(
  client: Queryable,
  ctx: AssistantContext,
  question: string,
  history: Turn[] = [],
): Promise<AssistantReply> {
  const now = ctx.now ?? new Date();
  const today = zonedDate(now, ctx.timezone);
  const routerCtx: RouterContext = { todayDow: zonedDayOfWeek(now, ctx.timezone) };

  const priorTurns = history.slice(-4).flatMap((turn) => [
    { role: "user" as const, content: turn.question },
    { role: "assistant" as const, content: turn.answer },
  ]);

  let calls: ToolCall[] = [];
  let usedModel = false;

  if (aiConfigured()) {
    const routed = await structuredCompletion({
      name: "assistant_route",
      schema: routeSchema,
      system:
        `You pick which of a fixed set of tools answer a question from the owner of ${ctx.shopName}, an auto repair shop. ` +
        `Today is ${longDate(today, ctx.timezone)} (${today}) in the shop's time zone. Choose at most ${MAX_TOOLS} tools; ` +
        `an empty list means none applies. Never invent tool names or arguments.\n\nTools:\n` +
        TOOL_NAMES.map((name) => `- ${name}: ${TOOL_DESCRIPTIONS[name]}`).join("\n"),
      input: { question },
      history: priorTurns,
      temperature: 0,
      timeoutMs: 12_000,
    });
    if (routed) {
      usedModel = true;
      calls = routed.data.tools;
    }
  }

  // The keyword router is the second opinion as well as the fallback: a
  // model that says "no tool applies" to "how busy is Manny" is wrong.
  if (calls.length === 0) calls = routeByKeywords(question, routerCtx);
  if (calls.length === 0) return helpReply(ctx.shopName);

  const results = await Promise.all(
    calls.map(async (call): Promise<ToolResult> => {
      try {
        return await TOOLS[call.name](client, { ...ctx, now }, call.args);
      } catch (error) {
        console.warn(`[assistant:${call.name}] failed`, error);
        return {
          name: call.name,
          args: call.args,
          text: `I couldn't read the ${call.name.replace(/([A-Z])/g, " $1").toLowerCase()} just now. Try again in a moment.`,
          links: [],
          data: null,
          failed: true,
        };
      }
    }),
  );

  const fallback = composeFallback(results);
  if (!usedModel || results.every((r) => r.failed)) {
    return { ...fallback, source: "fallback", tools: results.map((r) => r.name) };
  }

  const composed = await structuredCompletion({
    name: "assistant_answer",
    schema: answerSchema,
    system:
      `You write short answers for the owner of ${ctx.shopName}, an auto repair shop, strictly from the tool results you are given. ` +
      "Plain shop language, no marketing voice, no exclamation marks. Use the numbers and names exactly as given; never add a fact, a price or a date that is not in the results. " +
      "If the results are empty, say so plainly. Amounts are integer cents in the data — write them as dollars. " +
      `Times are in the shop's zone (${ctx.timezone}). Return at most 6 links, chosen only from the hrefs in the results, with short labels like "Open ticket #1047".`,
    input: {
      question,
      today,
      results: results.map((r) => ({ tool: r.name, args: r.args, data: r.data, links: r.links })),
    },
    history: priorTurns,
    temperature: 0.2,
    timeoutMs: 20_000,
  });

  if (!composed) {
    return { ...fallback, source: "fallback", tools: results.map((r) => r.name) };
  }

  const links = allowedLinks(composed.data.links, results);
  return {
    answer: composed.data.answer.trim(),
    links: links.length > 0 ? links : fallback.links,
    source: "openai",
    model: composed.model,
    tools: results.map((r) => r.name),
  };
}
