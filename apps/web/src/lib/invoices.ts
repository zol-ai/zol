import "server-only";

import { query, type Queryable } from "./db";
import { logRoEvent } from "./events";
import { formatCents } from "./money";
import { nextNumber } from "./numbering";
import { totalsFor } from "./ro-totals";
import type { InvoiceStatus, PaymentMethod, PaymentProvider, PaymentStatus } from "./statuses";

/**
 * The invoice: the ticket's approved lines, frozen a second time, when the
 * work is done.
 *
 * One per ticket (the schema's UNIQUE says so). Its lines are copies — an
 * advisor editing the ticket after the invoice went out must not move the
 * number the customer was asked to pay — and its totals are computed once,
 * here, with the same arithmetic the ticket uses (`totalsFor`), over approved
 * lines only. A pending line has no business on an invoice: the customer is
 * being asked to pay for what they agreed to.
 */

/** How long the customer has, printed on the invoice. */
const DUE_DAYS = 7;

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

export function invoiceBalanceCents(invoice: { total_cents: number; paid_cents: number }): number {
  return Math.max(0, invoice.total_cents - invoice.paid_cents);
}

/**
 * What the status column should read for a given paid amount. `void` and
 * `draft` are set by people and never derived; this only answers for the
 * three states money moves an invoice through.
 */
export function invoiceStatusFor(
  totalCents: number,
  paidCents: number,
): Extract<InvoiceStatus, "open" | "partial" | "paid"> {
  if (paidCents <= 0) return "open";
  if (paidCents >= totalCents) return "paid";
  return "partial";
}

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

export interface InvoiceRow {
  id: string;
  repair_order_id: string;
  estimate_id: string | null;
  customer_id: string;
  vehicle_id: string | null;
  number: number;
  status: InvoiceStatus;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  created_by_name: string | null;
}

export interface InvoiceLineRow {
  id: string;
  kind: string;
  description: string;
  quantity: string;
  unit_cents: number;
  total_cents: number;
  position: number;
}

export interface PaymentRow {
  id: string;
  amount_cents: number;
  method: PaymentMethod;
  provider: PaymentProvider;
  provider_ref: string | null;
  status: PaymentStatus;
  note: string | null;
  recorded_by_name: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface InvoiceBundle {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  payments: PaymentRow[];
}

/** The ticket's invoice with its lines and payments, or null when none exists. */
export async function invoiceForRepairOrder(
  shopId: string,
  repairOrderId: string,
): Promise<InvoiceBundle | null> {
  const invoices = await query<InvoiceRow>(
    `SELECT i.id, i.repair_order_id, i.estimate_id, i.customer_id, i.vehicle_id,
            i.number, i.status, i.subtotal_cents, i.tax_cents, i.total_cents,
            i.paid_cents, i.due_at::text, i.paid_at::text, i.created_at::text,
            s.full_name AS created_by_name
       FROM invoices i
       LEFT JOIN staff s ON s.id = i.created_by
      WHERE i.repair_order_id = $1 AND i.shop_id = $2`,
    [repairOrderId, shopId],
  );
  const invoice = invoices[0];
  if (!invoice) return null;

  const [lines, payments] = await Promise.all([
    query<InvoiceLineRow>(
      `SELECT id, kind, description, quantity::text, unit_cents, total_cents, position
         FROM invoice_lines WHERE invoice_id = $1 ORDER BY position, id`,
      [invoice.id],
    ),
    query<PaymentRow>(
      `SELECT p.id, p.amount_cents, p.method, p.provider, p.provider_ref, p.status,
              p.note, s.full_name AS recorded_by_name,
              p.processed_at::text, p.created_at::text
         FROM payments p
         LEFT JOIN staff s ON s.id = p.recorded_by
        WHERE p.invoice_id = $1 AND p.shop_id = $2
        ORDER BY p.created_at`,
      [invoice.id, shopId],
    ),
  ]);

  return { invoice, lines, payments };
}

// -----------------------------------------------------------------------------
// Creating one
// -----------------------------------------------------------------------------

export type CreateInvoiceResult =
  | { ok: true; id: string; number: number; totalCents: number }
  | { ok: false; reason: "no_ticket" | "exists" | "no_approved_lines" };

/**
 * Freeze the ticket's approved lines into an invoice.
 *
 * Refuses when the ticket already has one that is live, and when nothing on
 * the ticket has been approved — an invoice for zero dollars of agreed work
 * is a mistake, not a document.
 *
 * A voided invoice is the one case it will write over: the schema allows a
 * single invoice row per ticket, and an advisor who voided #3053 because a
 * line was wrong needs to bill the corrected ticket without opening a new
 * one. The row is reissued under a fresh number and the history says so;
 * the old number lives on in the timeline, which is where "what happened to
 * #3053?" gets answered.
 */
export async function createInvoiceForRepairOrder(
  client: Queryable,
  input: { shopId: string; repairOrderId: string; staffId: string | null },
): Promise<CreateInvoiceResult> {
  const { rows: ros } = await client.query<{
    id: string;
    customer_id: string;
    vehicle_id: string | null;
    tax_rate_pct: string;
    existing_id: string | null;
    existing_status: InvoiceStatus | null;
    existing_paid: number | null;
    estimate_id: string | null;
  }>(
    `SELECT ro.id, ro.customer_id, ro.vehicle_id, s.tax_rate_pct,
            i.id AS existing_id, i.status AS existing_status, i.paid_cents AS existing_paid,
            (SELECT e.id FROM estimates e
              WHERE e.repair_order_id = ro.id
              ORDER BY e.created_at DESC LIMIT 1) AS estimate_id
       FROM repair_orders ro
       JOIN shops s ON s.id = ro.shop_id
       LEFT JOIN invoices i ON i.repair_order_id = ro.id
      WHERE ro.id = $1 AND ro.shop_id = $2
      FOR UPDATE OF ro`,
    [input.repairOrderId, input.shopId],
  );
  const ro = ros[0];
  if (!ro) return { ok: false, reason: "no_ticket" };

  const reissuing = ro.existing_id && ro.existing_status === "void" && !ro.existing_paid;
  if (ro.existing_id && !reissuing) return { ok: false, reason: "exists" };

  const { rows: lines } = await client.query<{
    kind: string;
    description: string;
    quantity: string;
    unit_cents: number;
    total_cents: number;
  }>(
    `SELECT kind, description, quantity::text, unit_cents, total_cents
       FROM repair_order_lines
      WHERE repair_order_id = $1 AND approval = 'approved'
      ORDER BY position, created_at`,
    [ro.id],
  );
  if (lines.length === 0) return { ok: false, reason: "no_approved_lines" };

  const totals = totalsFor(lines, ro.tax_rate_pct);
  const number = await nextNumber(client, input.shopId, "invoice");

  let id: string;
  if (reissuing && ro.existing_id) {
    id = ro.existing_id;
    await client.query("DELETE FROM invoice_lines WHERE invoice_id = $1", [id]);
    await client.query(
      `UPDATE invoices
          SET number = $3, status = 'open', estimate_id = $4,
              subtotal_cents = $5, tax_cents = $6, total_cents = $7, paid_cents = 0,
              due_at = now() + interval '1 day' * $8, paid_at = NULL,
              created_by = $9, created_at = now()
        WHERE id = $1 AND shop_id = $2`,
      [id, input.shopId, number, ro.estimate_id, totals.subtotalCents, totals.taxCents, totals.totalCents, DUE_DAYS, input.staffId],
    );
  } else {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO invoices
         (shop_id, repair_order_id, estimate_id, customer_id, vehicle_id, number, status,
          subtotal_cents, tax_cents, total_cents, paid_cents, due_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, 0,
               now() + interval '1 day' * $10, $11)
       RETURNING id`,
      [
        input.shopId,
        ro.id,
        ro.estimate_id,
        ro.customer_id,
        ro.vehicle_id,
        number,
        totals.subtotalCents,
        totals.taxCents,
        totals.totalCents,
        DUE_DAYS,
        input.staffId,
      ],
    );
    id = rows[0].id;
  }

  for (const [position, line] of lines.entries()) {
    await client.query(
      `INSERT INTO invoice_lines (invoice_id, kind, description, quantity, unit_cents, total_cents, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, line.kind, line.description, line.quantity, line.unit_cents, line.total_cents, position],
    );
  }

  await logRoEvent(client, {
    shopId: input.shopId,
    repairOrderId: ro.id,
    kind: "invoice_created",
    detail: `Invoice #${number} created for ${formatCents(totals.totalCents)}${reissuing ? " (reissued after a void)" : ""}.`,
    actor: input.staffId ? "person" : "zol",
    staffId: input.staffId,
  });

  return { ok: true, id, number, totalCents: totals.totalCents };
}

/**
 * Void an invoice nothing has been paid against. Money already taken makes
 * this a refund conversation, not a button, so a paid or part-paid invoice
 * is refused.
 */
export async function voidInvoice(
  client: Queryable,
  input: { shopId: string; invoiceId: string; staffId: string | null },
): Promise<{ number: number; repairOrderId: string } | null> {
  const { rows } = await client.query<{ number: number; repair_order_id: string }>(
    `UPDATE invoices SET status = 'void'
      WHERE id = $1 AND shop_id = $2 AND paid_cents = 0 AND status IN ('draft', 'open')
      RETURNING number, repair_order_id`,
    [input.invoiceId, input.shopId],
  );
  const row = rows[0];
  if (!row) return null;

  // There is no invoice_voided event kind; a note on the timeline is the
  // honest record, and it names the number so the gap in numbering is explained.
  await logRoEvent(client, {
    shopId: input.shopId,
    repairOrderId: row.repair_order_id,
    kind: "note",
    detail: `Invoice #${row.number} voided.`,
    actor: input.staffId ? "person" : "zol",
    staffId: input.staffId,
  });

  return { number: row.number, repairOrderId: row.repair_order_id };
}
