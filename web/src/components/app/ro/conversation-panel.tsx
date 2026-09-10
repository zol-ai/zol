import { sendCustomerMessage } from "@/app/actions/messages";
import { Submit } from "@/components/app/field";
import { Section, Tag } from "@/components/app/ui";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { messagingStatus } from "@/lib/messaging/provider";
import type { MessageChannel, MessageDirection } from "@/lib/statuses";
import type { RoContext } from "./contracts";

/**
 * Messages to and from the customer on this ticket, plus the shop's own notes
 * to itself about them, in one thread.
 *
 * Everything on the ticket, and everything the customer sent that wasn't
 * tied to a ticket ("any update?" texted to the shop's line lands with no
 * repair_order_id). Reading the panel marks their inbound messages read — the
 * bell count and the Messages page both key off that.
 */
export async function ConversationPanel({ ro }: { ro: RoContext }) {
  const messages = await loadThread({
    shopId: ro.shopId,
    customerId: ro.customerId,
    repairOrderId: ro.id,
  });

  return (
    <Section
      id="conversation"
      title="Conversation"
      detail={ro.customerName ?? "Customer"}
      flush
    >
      <div className="px-4 py-4 sm:px-5">
        <MessageBubbles messages={messages} timezone={ro.timezone} />
      </div>
      <div className="border-t border-line px-4 py-4 sm:px-5">
        <MessageComposer
          customerId={ro.customerId}
          repairOrderId={ro.id}
          smsOptedOut={ro.smsOptedOut}
          returnTo={`/app/repair-orders/${ro.id}#conversation`}
        />
      </div>
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Data
// -----------------------------------------------------------------------------

export interface ThreadMessage {
  id: string;
  direction: MessageDirection;
  channel: MessageChannel;
  body: string;
  status: string;
  error_code: string | null;
  sent_by_agent: boolean;
  staff_name: string | null;
  repair_order_id: string | null;
  ro_number: number | null;
  read_at: string | null;
  created_at: string;
}

/**
 * The thread, oldest first. With a ticket: that ticket's messages plus the
 * customer's ticket-less ones. Without: everything for the customer.
 *
 * Inbound messages are marked read as a side effect, after the select so the
 * page still knows which ones were new. Fire-and-forget, like the portal's
 * last-viewed stamp: a bookkeeping write must never hold up the render.
 */
export async function loadThread(args: {
  shopId: string;
  customerId: string;
  repairOrderId?: string | null;
  limit?: number;
}): Promise<ThreadMessage[]> {
  const rows = await query<ThreadMessage>(
    `SELECT m.id, m.direction, m.channel, m.body, m.status, m.error_code,
            m.sent_by_agent, s.full_name AS staff_name,
            m.repair_order_id, ro.number AS ro_number,
            m.read_at::text, m.created_at::text
       FROM messages m
       LEFT JOIN staff s ON s.id = m.staff_id
       LEFT JOIN repair_orders ro ON ro.id = m.repair_order_id
      WHERE m.shop_id = $1 AND m.customer_id = $2
        AND ($3::uuid IS NULL OR m.repair_order_id = $3 OR m.repair_order_id IS NULL)
      ORDER BY m.created_at DESC
      LIMIT $4`,
    [args.shopId, args.customerId, args.repairOrderId ?? null, args.limit ?? 200],
  );

  void query(
    `UPDATE messages SET read_at = now()
      WHERE shop_id = $1 AND customer_id = $2 AND direction = 'inbound' AND read_at IS NULL
        AND ($3::uuid IS NULL OR repair_order_id = $3 OR repair_order_id IS NULL)`,
    [args.shopId, args.customerId, args.repairOrderId ?? null],
  ).catch(() => {});

  return rows.reverse();
}

// -----------------------------------------------------------------------------
// The thread
// -----------------------------------------------------------------------------

/**
 * Outbound on the right in emerald (the shop, or ZOL, speaking); inbound on
 * the left on paper; an internal note runs full width with a dashed amber
 * edge so it can't be mistaken for something the customer saw.
 */
export function MessageBubbles({
  messages,
  timezone,
  showTicket = false,
}: {
  messages: ThreadMessage[];
  timezone: string;
  showTicket?: boolean;
}) {
  if (messages.length === 0) {
    return (
      <p className="text-[0.875rem] text-ink-3">
        Nothing yet. ZOL&apos;s updates will land here as the job moves; anything you write below joins them.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {messages.map((message) => {
        const internal = message.direction === "internal";
        const outbound = message.direction === "outbound";
        const failed = message.status === "failed";
        const who = internal
          ? `${message.staff_name ?? "Someone at the shop"} · note`
          : outbound
            ? message.sent_by_agent || !message.staff_name
              ? "ZOL"
              : message.staff_name
            : "Customer";

        return (
          <li
            key={message.id}
            className={`flex ${internal ? "" : outbound ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-[10px] px-3.5 py-2.5 text-[0.9375rem] leading-relaxed ${
                internal
                  ? "w-full max-w-none border border-dashed border-amber-line bg-amber-wash text-ink"
                  : outbound
                    ? "bg-emerald-wash text-ink"
                    : "bg-paper-3 text-ink"
              }`}
            >
              <p className="whitespace-pre-line">{message.body}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-ink-3">
                <span className={internal ? "text-amber-deep" : outbound ? "text-emerald-deep" : ""}>
                  {who}
                </span>
                <span className="t-data">{formatDateTime(message.created_at, timezone)}</span>
                {!internal && message.channel === "portal" && <Tag tone="neutral">Repair page</Tag>}
                {!internal && message.channel === "email" && <Tag tone="neutral">Email</Tag>}
                {showTicket && message.ro_number && <Tag tone="neutral">#{message.ro_number}</Tag>}
                {failed && (
                  <Tag tone="red">Failed{message.error_code ? ` · ${message.error_code}` : ""}</Tag>
                )}
                {message.direction === "inbound" && !message.read_at && <Tag tone="person">New</Tag>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// -----------------------------------------------------------------------------
// The composer
// -----------------------------------------------------------------------------

/**
 * Text the customer, or leave a note for the shop. One box, a switch, Send.
 *
 * A customer who has texted STOP cannot be texted — the option isn't offered
 * and the reason is stated, because an advisor who can't see why will try
 * three more times. Notes are always available.
 */
export function MessageComposer({
  customerId,
  repairOrderId,
  smsOptedOut,
  returnTo,
}: {
  customerId: string;
  repairOrderId: string | null;
  smsOptedOut: boolean;
  returnTo: string;
}) {
  const status = messagingStatus();
  const id = repairOrderId ?? customerId;

  return (
    <form action={sendCustomerMessage} className="flex flex-col gap-3">
      <input type="hidden" name="customer_id" value={customerId} />
      {repairOrderId && <input type="hidden" name="repair_order_id" value={repairOrderId} />}
      <input type="hidden" name="return_to" value={returnTo} />

      <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
        <legend className="sr-only">Who is this for?</legend>
        <label className="flex items-center gap-2 text-[0.875rem] text-ink">
          <input
            type="radio"
            name="channel"
            value="text"
            defaultChecked={!smsOptedOut}
            disabled={smsOptedOut}
            className="accent-[var(--emerald-deep)]"
          />
          Text customer
        </label>
        <label className="flex items-center gap-2 text-[0.875rem] text-ink">
          <input
            type="radio"
            name="channel"
            value="note"
            defaultChecked={smsOptedOut}
            className="accent-[var(--amber-deep)]"
          />
          Internal note
        </label>
      </fieldset>

      {smsOptedOut ? (
        <p className="text-[0.8125rem] text-amber-deep">
          This customer texted STOP, so nothing can be sent to their phone. Call them, or leave a note here.
        </p>
      ) : status.mode === "portal-only" ? (
        <p className="text-[0.8125rem] text-ink-3">
          {status.reason} A text goes to their repair page for now and is marked as such.
        </p>
      ) : null}

      <label htmlFor={`compose-${id}`} className="sr-only">
        Message
      </label>
      <textarea
        id={`compose-${id}`}
        name="body"
        rows={3}
        required
        minLength={1}
        maxLength={1000}
        placeholder={smsOptedOut ? "Note for the shop…" : "Write to the customer, or switch to a note…"}
        className="input leading-relaxed"
      />

      <div className="flex items-center gap-3">
        <Submit className="btn btn-emerald btn-sm" pendingLabel="Sending…">
          Send
        </Submit>
        <span className="text-[0.8125rem] text-ink-3">Sends now — this isn&apos;t queued like ZOL&apos;s updates.</span>
      </div>
    </form>
  );
}
