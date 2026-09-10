import "server-only";

import { midSentence } from "../ai/followup";
import { query, tx, type Queryable } from "../db";
import { journeyMessage, queueFollowUp } from "../follow-ups";
import {
  getMessagingProvider,
  recordMessage,
  type SendResult,
} from "../messaging/provider";
import { formatCents } from "../money";
import { notifyShop } from "../notifications";
import { zonedDate, zonedToUtc } from "../schedule";

/**
 * The follow-up worker.
 *
 * `follow_ups` is the outbound queue: rows that pages and actions wrote with
 * `queueFollowUp`, plus the retention ones the CRM works through. Nothing
 * else in the product talks to the messaging provider; this file does, on a
 * schedule (Cloud Scheduler → POST /api/jobs/follow-ups, every five minutes)
 * and on demand ("Send now" on a CRM card calls `deliverFollowUp` directly so
 * the person isn't waiting on the clock).
 *
 * A send is two committed steps with the provider call between them, not one
 * transaction wrapped around it. The first claims the attempt — bumps
 * `attempts`, leaves a marker in `last_error` — and commits before anything
 * goes out, so a text Twilio has already accepted is never the one thing a
 * rollback forgets. The second records the message and settles the row. A
 * row whose claim landed but whose settlement didn't (the instance died
 * mid-batch, the pool dropped between the 201 and the INSERT) is visible as
 * exactly that, keeps its real attempt count, and is checked against the
 * messages table before it is tried again: a message already on file
 * finishes the row as sent rather than sending it twice.
 *
 * Nothing holds the row between those commits, so an advisory lock keyed on
 * the id does what FOR UPDATE used to do across the send: taken in an outer
 * transaction that lives as long as the send is in flight, released with it
 * however it ends. A second worker instance, or "Send now" pressed while the
 * scheduler is on the same row, gets false from the try-lock and moves on.
 * The price is a second pool connection per row for the duration.
 *
 * Cross-tenant by design. The scheduler has no shop; every row carries its
 * shop_id and is sent from that shop's own number. It is the one place in the
 * app that reads `follow_ups` without a shop in the WHERE, and it writes
 * nothing a shop didn't queue for itself.
 */

/** After this many failed attempts a row stops retrying and a person is told. */
export const MAX_ATTEMPTS = 5;

// -----------------------------------------------------------------------------
// Pure parts — no database, no clock. Tested in follow-ups.test.ts.
// -----------------------------------------------------------------------------

export interface Settlement {
  status: "sent" | "pending" | "failed";
  attempts: number;
  lastError: string | null;
}

/**
 * What one attempt does to the row. A permanent failure (bad number, STOP)
 * stops immediately; a transient one goes round again until the ceiling.
 */
export function settleAttempt(result: SendResult, attemptsSoFar: number): Settlement {
  const attempts = attemptsSoFar + 1;
  if (result.delivered) return { status: "sent", attempts, lastError: null };
  const exhausted = result.permanent || attempts >= MAX_ATTEMPTS;
  return { status: exhausted ? "failed" : "pending", attempts, lastError: result.reason };
}

/**
 * What the claim leaves in `last_error` while the send is in flight; the
 * settlement clears or replaces it. A pending row still carrying it on the
 * next pass was cut off between the two.
 */
export const IN_FLIGHT = "cut off before the outcome was recorded";

export type AttemptPlan =
  /** A message from an earlier attempt is on file: finish the row, send nothing. */
  | { action: "finish"; via: "sms" | "portal" }
  | { action: "cancel"; reason: string }
  | { action: "fail"; reason: string; notify: boolean }
  | { action: "claim"; body: string };

/**
 * What the first phase does with a pending row, decided before anything is
 * sent. A recorded message wins over everything else: it means an earlier
 * attempt got through and only the bookkeeping was lost, and the remedy for
 * that is never a second text. Opting out and an empty body close the row
 * without an attempt being counted. The ceiling is for a row whose attempts
 * were claimed and never settled — an ordinary failure is counted and
 * capped by `settleAttempt`, so a row only arrives here at the ceiling when
 * something kept cutting it off, and that is worth telling the shop.
 */
export function planAttempt(
  row: { sms_opted_out: boolean; body: string | null; attempts: number },
  recorded: { channel: string } | null,
): AttemptPlan {
  if (recorded) {
    return { action: "finish", via: recorded.channel === "sms" ? "sms" : "portal" };
  }
  if (row.sms_opted_out) return { action: "cancel", reason: "opted out" };
  if (!row.body || row.body.trim().length === 0) {
    return { action: "fail", reason: "no message body", notify: false };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { action: "fail", reason: `gave up after ${row.attempts} attempts`, notify: true };
  }
  return { action: "claim", body: row.body };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Is `today` (YYYY-MM-DD, in the shop's zone) this person's birthday? Month
 * and day only — the year is theirs to keep. Somebody born on the 29th of
 * February is wished happy birthday on the 28th in the years that lack one,
 * rather than every four years.
 */
export function isBirthdayOn(birthday: string, today: string): boolean {
  const [, bMonth, bDay] = birthday.slice(0, 10).split("-").map(Number);
  const [tYear, tMonth, tDay] = today.slice(0, 10).split("-").map(Number);
  if (![bMonth, bDay, tYear, tMonth, tDay].every(Number.isFinite)) return false;
  if (bMonth === tMonth && bDay === tDay) return true;
  return bMonth === 2 && bDay === 29 && tMonth === 2 && tDay === 28 && !isLeapYear(tYear);
}

export interface WorkerSummary {
  generated: { declinedRecalls: number; birthdays: number };
  /** Rows that were due when the run started. */
  considered: number;
  sent: number;
  /** Transient failures, left pending for the next pass. */
  retried: number;
  /** Gave up: permanent error or the attempt ceiling. */
  failed: number;
  /** Customer has opted out; the row is closed as cancelled. */
  cancelled: number;
  /** Locked by another worker, or no longer pending by the time we got there. */
  skipped: number;
  /** The batch filled up; there is more behind it. */
  truncated: boolean;
}

/** The one line a run leaves in the log. */
export function summaryLine(summary: WorkerSummary): string {
  return (
    `[follow-ups] ${summary.considered} considered, ${summary.sent} sent, ` +
    `${summary.retried} retrying, ${summary.failed} failed, ` +
    `${summary.cancelled} cancelled, ${summary.skipped} skipped` +
    ` · queued ${summary.generated.declinedRecalls} declined-work ` +
    `${summary.generated.declinedRecalls === 1 ? "recall" : "recalls"}, ` +
    `${summary.generated.birthdays} ${summary.generated.birthdays === 1 ? "birthday" : "birthdays"}` +
    (summary.truncated ? " · batch full, more waiting" : "")
  );
}

// -----------------------------------------------------------------------------
// Delivery
// -----------------------------------------------------------------------------

export type DeliveryOutcome =
  | { status: "sent"; via: "sms" | "portal" }
  | { status: "retry"; reason: string; attempts: number }
  | { status: "failed"; reason: string }
  | { status: "cancelled"; reason: string }
  | { status: "skipped"; reason: string };

interface DueRow {
  id: string;
  shop_id: string;
  customer_id: string;
  repair_order_id: string | null;
  declined_work_id: string | null;
  kind: string;
  body: string | null;
  channel: "sms" | "email" | "portal";
  /** As read under lock — the count *before* this attempt was claimed. */
  attempts: number;
  phone: string;
  sms_opted_out: boolean;
  full_name: string | null;
  twilio_number: string | null;
}

type ClaimedRow = DueRow & { body: string };

type Claim =
  | { kind: "settled"; outcome: DeliveryOutcome }
  | { kind: "claimed"; row: ClaimedRow };

/**
 * Send one follow-up, now, whatever it was scheduled for.
 *
 * `scope.shopId` is for callers with a session: the CRM checks the row is the
 * shop's own before it goes anywhere. The scheduler has no shop and passes
 * nothing.
 */
export async function deliverFollowUp(
  id: string,
  scope?: { shopId: string },
): Promise<DeliveryOutcome> {
  const provider = getMessagingProvider();

  // The hold (see the file comment). This transaction writes nothing; it is
  // here to keep the advisory lock for as long as the row is in flight.
  return tx(async (hold) => {
    const { rows: locks } = await hold.query<{ held: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS held",
      [id],
    );
    if (!locks[0]?.held) return { status: "skipped", reason: "another worker has it" };

    const claim = await tx((client) => claimAttempt(client, id, scope));
    if (claim.kind === "settled") return claim.outcome;
    const { row } = claim;

    const result = await provider.send({
      to: row.phone,
      from: row.twilio_number,
      body: row.body,
      channel: row.channel,
    });

    if (result.delivered) {
      // On its own commit, ahead of the settlement: from here a crash leaves
      // the message on file, and the next pass finishes the row from it
      // instead of texting again.
      await tx((client) =>
        recordMessage(client, {
          shopId: row.shop_id,
          customerId: row.customer_id,
          repairOrderId: row.repair_order_id,
          direction: "outbound",
          // `via`, not the channel asked for: while telephony is off an SMS
          // follow-up lands on the portal, and the record says where it went.
          channel: result.via,
          body: row.body,
          followUpId: row.id,
          twilioSid: result.providerId ?? null,
          status: result.via === "portal" ? "delivered" : "sent",
          sentByAgent: true,
        }),
      );
    }

    return tx((client) => settleFollowUp(client, row, result));
  });
}

/**
 * Phase one, its own transaction: read the row under lock, decide, and if it
 * is going out, count the attempt before it is made.
 */
async function claimAttempt(
  client: Queryable,
  id: string,
  scope?: { shopId: string },
): Promise<Claim> {
  const { rows } = await client.query<DueRow>(
    `SELECT f.id, f.shop_id, f.customer_id, f.repair_order_id, f.declined_work_id,
            f.kind, f.body, f.channel, f.attempts,
            c.phone, c.sms_opted_out, c.full_name,
            s.twilio_number
       FROM follow_ups f
       JOIN customers c ON c.id = f.customer_id
       JOIN shops s ON s.id = f.shop_id
      WHERE f.id = $1
        AND f.status = 'pending'
        AND ($2::uuid IS NULL OR f.shop_id = $2)
      FOR UPDATE OF f SKIP LOCKED`,
    [id, scope?.shopId ?? null],
  );

  const row = rows[0];
  if (!row) {
    return {
      kind: "settled",
      outcome: { status: "skipped", reason: "not pending, or another worker has it" },
    };
  }

  // Only a row that has been claimed before can have a message on file.
  const recorded = row.attempts > 0 ? await recordedMessage(client, row) : null;
  const plan = planAttempt(row, recorded);

  switch (plan.action) {
    case "finish":
      // sent_at is when the message actually went, not when we noticed.
      await client.query(
        `UPDATE follow_ups
            SET status = 'sent', last_error = NULL,
                sent_at = coalesce((SELECT max(m.created_at) FROM messages m
                                     WHERE m.follow_up_id = follow_ups.id
                                       AND m.direction = 'outbound'), now())
          WHERE id = $1`,
        [row.id],
      );
      await stampDeclinedWork(client, row);
      return { kind: "settled", outcome: { status: "sent", via: plan.via } };

    case "cancel":
      /*
        Checked at send time, not queue time. A customer who texted STOP after
        the row was written must not hear from us; the row is closed with the
        reason on it so the CRM shows why nothing went out.
      */
      await client.query(
        `UPDATE follow_ups
            SET status = 'cancelled', last_error = $2, completed_at = now()
          WHERE id = $1`,
        [row.id, plan.reason],
      );
      return { kind: "settled", outcome: { status: "cancelled", reason: plan.reason } };

    case "fail":
      await client.query(
        `UPDATE follow_ups
            SET status = 'failed', last_error = $2, completed_at = now()
          WHERE id = $1`,
        [row.id, plan.reason],
      );
      if (plan.notify) await tellShopItStopped(client, row, plan.reason);
      return { kind: "settled", outcome: { status: "failed", reason: plan.reason } };

    case "claim":
      await client.query(
        `UPDATE follow_ups SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
        [row.id, IN_FLIGHT],
      );
      // `row.attempts` stays the pre-claim count: `settleAttempt` adds the
      // one the claim just wrote, so the two agree on the number.
      return { kind: "claimed", row: { ...row, body: plan.body } };
  }
}

/**
 * Phase two, its own transaction, once the provider has answered. The
 * attempt is already counted; this writes what came of it. The failure
 * branch keeps a `status = 'pending'` guard because nothing held the row
 * during the send: a person who cancelled it in that window has cancelled
 * it. The success branch has no such guard — the message went, and 'sent'
 * is the truth whatever happened to the row meanwhile.
 */
async function settleFollowUp(
  client: Queryable,
  row: ClaimedRow,
  result: SendResult,
): Promise<DeliveryOutcome> {
  const settled = settleAttempt(result, row.attempts);

  if (result.delivered) {
    await client.query(
      `UPDATE follow_ups
          SET status = 'sent', sent_at = now(), attempts = $2, last_error = NULL
        WHERE id = $1`,
      [row.id, settled.attempts],
    );
    await stampDeclinedWork(client, row);
    return { status: "sent", via: result.via };
  }

  await client.query(
    `UPDATE follow_ups
        SET status = $2, attempts = $3, last_error = $4,
            completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE completed_at END
      WHERE id = $1 AND status = 'pending'`,
    [row.id, settled.status, settled.attempts, settled.lastError],
  );

  if (settled.status === "failed") {
    await tellShopItStopped(client, row, settled.lastError ?? "Delivery failed");
    return { status: "failed", reason: settled.lastError ?? "delivery failed" };
  }

  return {
    status: "retry",
    reason: settled.lastError ?? "delivery failed",
    attempts: settled.attempts,
  };
}

/** The outbound message an earlier attempt left on file for this row, if any. */
async function recordedMessage(
  client: Queryable,
  row: { id: string; customer_id: string },
): Promise<{ channel: string } | null> {
  // customer_id leads: it is the indexed column, and a row's message can
  // only ever be against its own customer.
  const { rows } = await client.query<{ channel: string }>(
    `SELECT channel FROM messages
      WHERE customer_id = $1 AND follow_up_id = $2 AND direction = 'outbound'
      ORDER BY created_at DESC
      LIMIT 1`,
    [row.customer_id, row.id],
  );
  return rows[0] ?? null;
}

/** The recall list reads reminded_at as "we have raised this". */
async function stampDeclinedWork(
  client: Queryable,
  row: { declined_work_id: string | null; shop_id: string },
): Promise<void> {
  if (!row.declined_work_id) return;
  await client.query(
    `UPDATE declined_work SET reminded_at = coalesce(reminded_at, now())
      WHERE id = $1 AND shop_id = $2`,
    [row.declined_work_id, row.shop_id],
  );
}

/** The row has stopped trying; somebody has to pick up the phone. */
async function tellShopItStopped(
  client: Queryable,
  row: { shop_id: string; full_name: string | null },
  reason: string,
): Promise<void> {
  await notifyShop(client, row.shop_id, {
    kind: "follow_up",
    title: `Couldn't reach ${row.full_name ?? "a customer"}`,
    body: `${reason} — the follow-up is marked failed. A call may be the way.`,
    href: "/app/crm",
  });
}

// -----------------------------------------------------------------------------
// Generators — rows the calendar creates, not a person
// -----------------------------------------------------------------------------

interface RecallCandidate {
  id: string;
  shop_id: string;
  customer_id: string;
  vehicle_id: string | null;
  repair_order_id: string | null;
  description: string;
  estimated_cents: number | null;
  days_ago: number;
  shop_name: string;
  public_phone: string | null;
  vehicle: string | null;
}

/**
 * Declined work whose reminder date has arrived becomes a recall follow-up.
 * `reminded_at` is stamped as the row is queued, so the same item is never
 * queued twice; the declined-work screen reads the same column as "raised".
 */
async function queueDeclinedRecalls(): Promise<number> {
  const candidates = await query<RecallCandidate>(
    `SELECT d.id, d.shop_id, d.customer_id, d.vehicle_id, d.repair_order_id,
            d.description, d.estimated_cents,
            greatest(0, floor(extract(epoch FROM now() - d.declined_at) / 86400))::int AS days_ago,
            s.name AS shop_name, s.public_phone,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle
       FROM declined_work d
       JOIN shops s ON s.id = d.shop_id
       LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.remind_after IS NOT NULL
        AND d.remind_after <= now()
        AND d.reminded_at IS NULL
        AND d.resolved_at IS NULL
        AND NOT EXISTS (
              SELECT 1 FROM follow_ups f
               WHERE f.declined_work_id = d.id AND f.status = 'pending')
      ORDER BY d.remind_after
      LIMIT 100`,
  );

  let queued = 0;
  for (const item of candidates) {
    await tx(async (client) => {
      const message = journeyMessage("declined_work_recall", {
        shopName: item.shop_name,
        shopPhone: item.public_phone,
        vehicle: item.vehicle,
        work: midSentence(item.description),
      });
      const id = await queueFollowUp(client, {
        shopId: item.shop_id,
        customerId: item.customer_id,
        repairOrderId: item.repair_order_id,
        vehicleId: item.vehicle_id,
        declinedWorkId: item.id,
        kind: "declined_work_recall",
        title: `Declined work: ${item.description}`,
        details:
          `Declined ${item.days_ago} ${item.days_ago === 1 ? "day" : "days"} ago` +
          (item.estimated_cents != null ? ` — was ${formatCents(item.estimated_cents)}` : "") +
          ".",
        body: message.body,
        source: "zol",
      });
      // The same statement whether or not queueFollowUp deduped against a
      // pending recall on the same ticket: either way this item has been raised.
      await client.query(
        `UPDATE declined_work SET reminded_at = now()
          WHERE id = $1 AND reminded_at IS NULL`,
        [item.id],
      );
      if (id) queued += 1;
    });
  }
  return queued;
}

interface BirthdayCandidate {
  id: string;
  shop_id: string;
  full_name: string | null;
  birthday: string;
  shop_name: string;
  timezone: string;
}

/**
 * A birthday text, once a year, at nine in the morning where the shop is.
 * SQL narrows to people whose birthday month is the shop's current month;
 * the exact-day rule (including the 29th of February) lives in
 * `isBirthdayOn` where it can be tested without a database.
 */
async function queueBirthdays(now: Date): Promise<number> {
  const candidates = await query<BirthdayCandidate>(
    `SELECT c.id, c.shop_id, c.full_name, c.birthday::text,
            s.name AS shop_name, s.timezone
       FROM customers c
       JOIN shops s ON s.id = c.shop_id
      WHERE c.birthday IS NOT NULL
        AND c.sms_opted_out = false
        AND extract(month FROM c.birthday)
            = extract(month FROM (now() AT TIME ZONE s.timezone))
        AND NOT EXISTS (
              SELECT 1 FROM follow_ups f
               WHERE f.customer_id = c.id AND f.kind = 'birthday'
                 AND f.created_at > now() - interval '300 days')`,
  );

  let queued = 0;
  for (const person of candidates) {
    const today = zonedDate(now, person.timezone);
    if (!isBirthdayOn(person.birthday, today)) continue;

    const firstName = person.full_name?.split(" ")[0] ?? null;
    const message = journeyMessage("birthday", { shopName: person.shop_name, firstName });
    // Nine in the morning, or straight away if the day is already under way.
    const nineAm = zonedToUtc(today, "09:00", person.timezone) ?? now;
    const scheduledFor = nineAm > now ? nineAm : now;

    const id = await tx((client) =>
      queueFollowUp(client, {
        shopId: person.shop_id,
        customerId: person.id,
        kind: "birthday",
        title: "Birthday",
        details: `${firstName ?? "Their"} birthday is today.`,
        body: message.body,
        scheduledFor,
        source: "zol",
      }),
    );
    if (id) queued += 1;
  }
  return queued;
}

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

/**
 * One pass: queue what the calendar says is due, then send what is due.
 * Generators run first so a recall that came due this morning goes out in
 * the same pass rather than the next one.
 */
export async function runFollowUpWorker(
  options: { limit?: number; now?: Date } = {},
): Promise<WorkerSummary> {
  const limit = options.limit ?? 50;
  const now = options.now ?? new Date();

  const summary: WorkerSummary = {
    generated: { declinedRecalls: 0, birthdays: 0 },
    considered: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    truncated: false,
  };

  // A generator that fails must not stop the queue from draining; the rows
  // it would have written are picked up on the next pass.
  try {
    summary.generated.declinedRecalls = await queueDeclinedRecalls();
  } catch (error) {
    console.error("[follow-ups] declined-work recall generator failed", error);
  }
  try {
    summary.generated.birthdays = await queueBirthdays(now);
  } catch (error) {
    console.error("[follow-ups] birthday generator failed", error);
  }

  // Oldest due first, bounded, so a backlog drains in order and one request
  // can't outlive the scheduler's deadline. What's left goes next pass.
  const due = await query<{ id: string }>(
    `SELECT id FROM follow_ups
      WHERE status = 'pending' AND scheduled_for <= $1
      ORDER BY scheduled_for
      LIMIT $2`,
    [now, limit],
  );
  summary.considered = due.length;
  summary.truncated = due.length === limit;

  for (const { id } of due) {
    let outcome: DeliveryOutcome;
    try {
      outcome = await deliverFollowUp(id);
    } catch (error) {
      // The attempt was counted when it was claimed, so there is nothing to
      // add but the reason — and a throw before the claim left the row
      // untouched, which is what the next pass should see. A row that keeps
      // being cut off still reaches the ceiling: the claim counts, and the
      // next pass fails it there. Guarded on pending because nothing held
      // the row while it was in flight.
      const reason = error instanceof Error ? error.message : "delivery threw";
      console.error(`[follow-ups] ${id} threw`, error);
      await query(
        `UPDATE follow_ups SET last_error = $2 WHERE id = $1 AND status = 'pending'`,
        [id, reason.slice(0, 500)],
      ).catch(() => {});
      outcome = { status: "retry", reason, attempts: -1 };
    }

    switch (outcome.status) {
      case "sent":
        summary.sent += 1;
        break;
      case "retry":
        summary.retried += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      case "cancelled":
        summary.cancelled += 1;
        break;
      case "skipped":
        summary.skipped += 1;
        break;
    }
  }

  console.info(summaryLine(summary));
  return summary;
}
