"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { draftFollowUp } from "@/lib/ai/followup";
import { journeyMessage, queueFollowUp } from "@/lib/follow-ups";
import { formatDate } from "@/lib/format";
import { deliverFollowUp } from "@/lib/jobs/follow-ups";
import { FOLLOW_UP_KINDS, type FollowUpKind } from "@/lib/statuses";
import type { FormState } from "./auth";

/**
 * The CRM's buttons.
 *
 * A follow-up is a row in the outbound queue, and every button here changes
 * one row: drafts words for it, edits the words, sends it now instead of
 * waiting for the worker, or closes it because a person rang instead. None
 * of them talk to a provider directly — "Send now" calls the same
 * `deliverFollowUp` the scheduled worker uses, so a message sent from the
 * CRM and one sent at 2am are indistinguishable in the messages table.
 *
 * Every statement is scoped by shop_id from the session. The id in the form
 * narrows; the session decides.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Where to land after the button. The cards render on the CRM, on a
 * customer's page and on a vehicle's page, and each wants the person back
 * where they were. Only paths inside the app are honoured — a form field is
 * not allowed to send somebody off-site.
 */
function returnTo(form: FormData, fallback = "/app/crm"): string {
  const raw = text(form, "return_to");
  return /^\/app(\/[A-Za-z0-9\-_/]*)?$/.test(raw) ? raw : fallback;
}

/** The kind column is CHECKed by Postgres; this narrows the string for the drafter. */
function isFollowUpKind(value: string): value is FollowUpKind {
  return (FOLLOW_UP_KINDS as readonly string[]).includes(value);
}

function withQuery(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return search ? `${path}?${search}` : path;
}

interface OwnedFollowUp {
  id: string;
  status: string;
  kind: string;
  title: string | null;
  details: string | null;
  body: string | null;
  ai_draft: string | null;
  customer_id: string;
  declined_work_id: string | null;
  repair_order_id: string | null;
  first_name: string | null;
  vehicle: string | null;
  ro_number: number | null;
  work: string | null;
  last_visit: string | null;
  shop_name: string;
  public_phone: string | null;
}

/** The row, with what the drafter needs, or null if it isn't this shop's. */
async function loadOwned(id: string, shopId: string): Promise<OwnedFollowUp | null> {
  const rows = await query<OwnedFollowUp>(
    `SELECT f.id, f.status, f.kind, f.title, f.details, f.body, f.ai_draft,
            f.customer_id, f.declined_work_id, f.repair_order_id,
            split_part(coalesce(c.full_name, ''), ' ', 1) AS first_name,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
            ro.number AS ro_number,
            d.description AS work,
            (SELECT max(coalesce(r.closed_at, r.created_at))::text
               FROM repair_orders r
              WHERE r.customer_id = c.id AND r.shop_id = f.shop_id) AS last_visit,
            s.name AS shop_name, s.public_phone
       FROM follow_ups f
       JOIN customers c ON c.id = f.customer_id
       JOIN shops s ON s.id = f.shop_id
       LEFT JOIN vehicles v ON v.id = f.vehicle_id
       LEFT JOIN repair_orders ro ON ro.id = f.repair_order_id
       LEFT JOIN declined_work d ON d.id = f.declined_work_id
      WHERE f.id = $1 AND f.shop_id = $2`,
    [id, shopId],
  );
  return rows[0] ?? null;
}

// -----------------------------------------------------------------------------
// Drafting
// -----------------------------------------------------------------------------

/** Ask the model for words, from facts the shop already has. Stores `ai_draft`. */
export async function generateFollowUpDraft(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const back = returnTo(form);

  const row = await loadOwned(id, user.shopId);
  if (!row || !isFollowUpKind(row.kind)) redirect(back);

  const draft = await draftFollowUp({
    shopName: row.shop_name,
    shopPhone: row.public_phone,
    kind: row.kind,
    customerFirstName: row.first_name || null,
    vehicle: row.vehicle,
    title: row.title,
    details: row.details,
    work: row.work,
    lastVisit: row.last_visit ? formatDate(row.last_visit, user.timezone) : null,
    roNumber: row.ro_number,
  });

  // The source is stored with the draft, so the card can say whether a model
  // or the template wrote it — not whether a key happens to be set today.
  await query(
    `UPDATE follow_ups SET ai_draft = $3, ai_source = $4 WHERE id = $1 AND shop_id = $2`,
    [id, user.shopId, draft.message, draft.source],
  );

  revalidatePath(back);
  redirect(withQuery(back, { drafted: id, via: draft.source }));
}

/** The person is happy with the draft: it becomes what the customer will get. */
export async function applyFollowUpDraft(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const back = returnTo(form);

  await query(
    `UPDATE follow_ups SET body = ai_draft
      WHERE id = $1 AND shop_id = $2 AND status = 'pending' AND ai_draft IS NOT NULL`,
    [id, user.shopId],
  );

  revalidatePath(back);
  redirect(back);
}

/** Edit the words by hand. */
export async function saveFollowUpBody(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const id = text(form, "id");
  const body = text(form, "body");
  const back = returnTo(form);

  const fields: Record<string, string> = {};
  if (body.length < 2) fields.body = "Something for them to read.";
  // A text over 320 characters is split by the carrier into pieces that can
  // arrive out of order; the templates stay well under it and so should edits.
  if (body.length > 480) fields.body = "Too long for a text. Keep it under 480 characters.";
  if (Object.keys(fields).length > 0) return { fields, values: { body } };

  await query(
    `UPDATE follow_ups SET body = $3
      WHERE id = $1 AND shop_id = $2 AND status = 'pending'`,
    [id, user.shopId, body],
  );

  revalidatePath(back);
  redirect(back);
}

// -----------------------------------------------------------------------------
// Sending and closing
// -----------------------------------------------------------------------------

/** Send it now, through the same path the worker uses. */
export async function sendFollowUpNow(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const back = returnTo(form);

  // Scoped: the delivery query carries the shop id, so a pasted uuid from
  // another tenant is simply "not pending" here.
  const outcome = await deliverFollowUp(id, { shopId: user.shopId });

  revalidatePath(back);
  // Only the outcome travels in the query string. The reason is provider
  // text — Twilio's includes the number it rejected — and the card already
  // shows it from last_error; putting it in the URL would put a customer's
  // phone number in browser history and request logs.
  redirect(
    withQuery(back, {
      sent: id,
      outcome: outcome.status,
      ...(outcome.status === "sent" ? { via: outcome.via } : {}),
    }),
  );
}

/**
 * Closed by a person without a message going out — they rang, or raised it
 * at the counter. Distinct from cancelled ("we decided not to") and sent.
 */
export async function markFollowUpDone(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const back = returnTo(form);

  await tx(async (client) => {
    const { rows } = await client.query<{ declined_work_id: string | null }>(
      `UPDATE follow_ups
          SET status = 'done', completed_at = now(), completed_by = $3
        WHERE id = $1 AND shop_id = $2 AND status = 'pending'
        RETURNING declined_work_id`,
      [id, user.shopId, user.staffId],
    );
    // Raising it by phone counts as raising it: the recall list agrees.
    const declinedWorkId = rows[0]?.declined_work_id;
    if (declinedWorkId) {
      await client.query(
        `UPDATE declined_work SET reminded_at = coalesce(reminded_at, now())
          WHERE id = $1 AND shop_id = $2`,
        [declinedWorkId, user.shopId],
      );
    }
  });

  revalidatePath(back);
  redirect(back);
}

export async function cancelFollowUp(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const back = returnTo(form);

  await query(
    `UPDATE follow_ups
        SET status = 'cancelled', completed_at = now(), completed_by = $3
      WHERE id = $1 AND shop_id = $2 AND status = 'pending'`,
    [id, user.shopId, user.staffId],
  );

  revalidatePath(back);
  redirect(back);
}

// -----------------------------------------------------------------------------
// Win-backs
// -----------------------------------------------------------------------------

interface WinBackCandidate {
  id: string;
  full_name: string | null;
  vehicle_id: string | null;
  vehicle: string | null;
  last_at: string;
  shop_name: string;
  public_phone: string | null;
}

/**
 * Customers the shop hasn't seen in six months, with nothing open and no
 * win-back already waiting, each get one queued for now. Opted-out customers
 * are left alone: a win-back is a text, and they've said no to texts.
 */
export async function findWinBacks(form: FormData): Promise<void> {
  const user = await requireUser();
  const back = returnTo(form);

  const candidates = await query<WinBackCandidate>(
    `WITH last_visit AS (
       SELECT ro.customer_id, max(coalesce(ro.closed_at, ro.created_at)) AS last_at
         FROM repair_orders ro
        WHERE ro.shop_id = $1 AND ro.status = 'closed'
        GROUP BY ro.customer_id
     )
     SELECT c.id, c.full_name, lv.last_at::text,
            v.id AS vehicle_id,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
            s.name AS shop_name, s.public_phone
       FROM customers c
       JOIN last_visit lv ON lv.customer_id = c.id
       JOIN shops s ON s.id = c.shop_id
       LEFT JOIN LATERAL (
         SELECT v.id, v.year, v.make, v.model
           FROM vehicles v
          WHERE v.customer_id = c.id
          ORDER BY v.updated_at DESC
          LIMIT 1
       ) v ON true
      WHERE c.shop_id = $1
        AND c.sms_opted_out = false
        AND lv.last_at < now() - interval '180 days'
        AND NOT EXISTS (
              SELECT 1 FROM repair_orders o
               WHERE o.customer_id = c.id AND o.status NOT IN ('closed', 'cancelled'))
        AND NOT EXISTS (
              SELECT 1 FROM appointments a
               WHERE a.customer_id = c.id AND a.starts_at > now()
                 AND a.status IN ('booked', 'confirmed'))
        AND NOT EXISTS (
              SELECT 1 FROM follow_ups f
               WHERE f.customer_id = c.id AND f.kind = 'win_back'
                 AND (f.status = 'pending' OR f.created_at > now() - interval '180 days'))
      ORDER BY lv.last_at
      LIMIT 200`,
    [user.shopId],
  );

  let queued = 0;
  await tx(async (client) => {
    for (const person of candidates) {
      const message = journeyMessage("win_back", {
        shopName: person.shop_name,
        shopPhone: person.public_phone,
        vehicle: person.vehicle,
      });
      const id = await queueFollowUp(client, {
        shopId: user.shopId,
        customerId: person.id,
        vehicleId: person.vehicle_id,
        kind: "win_back",
        title: "Win back",
        details: `Last visit ${formatDate(person.last_at, user.timezone)}. Nothing booked since.`,
        body: message.body,
        source: "person",
      });
      if (id) queued += 1;
    }
  });

  revalidatePath(back);
  redirect(withQuery(back, { winbacks: String(queued) }));
}
