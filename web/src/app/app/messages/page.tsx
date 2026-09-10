import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import {
  loadThread,
  MessageBubbles,
  MessageComposer,
} from "@/components/app/ro/conversation-panel";
import { PageHead } from "@/components/app/shell";
import { Avatar, EmptyState, Tag } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatRelative } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export const metadata = { title: "Messages" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every conversation, one thread per customer.
 *
 * A customer, not a ticket, is the thread: the person who texts "any update
 * on the Camry?" doesn't know or care which repair order it lands on, and
 * the advisor answering wants the whole history with that person in one
 * place. Ticket numbers are tagged on the bubbles instead.
 *
 * Unread means an inbound message nobody has opened. Opening the thread
 * here, or the conversation panel on the ticket, clears it.
 */

interface Thread {
  customer_id: string;
  customer_name: string | null;
  phone: string;
  sms_opted_out: boolean;
  last_body: string;
  last_direction: string;
  last_channel: string;
  last_at: string;
  unread: number;
  open_tickets: number;
}

export default async function MessagesPage(props: PageProps<"/app/messages">) {
  const user = await requireUser();
  const params = await props.searchParams;
  const unreadOnly = params.unread === "1";
  // A uuid that isn't one is ignored rather than sent to Postgres to throw
  // on the cast; the page falls back to the list with nothing open.
  const selected =
    typeof params.customer === "string" && UUID.test(params.customer) ? params.customer : null;

  const threads = await query<Thread>(
    `SELECT c.id AS customer_id, c.full_name AS customer_name, c.phone, c.sms_opted_out,
            m.body AS last_body, m.direction AS last_direction, m.channel AS last_channel,
            m.created_at::text AS last_at,
            (SELECT count(*) FROM messages u
              WHERE u.customer_id = c.id AND u.shop_id = $1
                AND u.direction = 'inbound' AND u.read_at IS NULL)::int AS unread,
            (SELECT count(*) FROM repair_orders ro
              WHERE ro.customer_id = c.id AND ro.shop_id = $1
                AND ro.status NOT IN ('closed', 'cancelled'))::int AS open_tickets
       FROM customers c
       JOIN LATERAL (
         SELECT body, direction, channel, created_at
           FROM messages
          WHERE customer_id = c.id AND shop_id = $1
          ORDER BY created_at DESC LIMIT 1) m ON true
      WHERE c.shop_id = $1
        AND (NOT $2::boolean OR EXISTS (
              SELECT 1 FROM messages u
               WHERE u.customer_id = c.id AND u.shop_id = $1
                 AND u.direction = 'inbound' AND u.read_at IS NULL))
      ORDER BY (SELECT count(*) FROM messages u
                 WHERE u.customer_id = c.id AND u.shop_id = $1
                   AND u.direction = 'inbound' AND u.read_at IS NULL) > 0 DESC,
               m.created_at DESC
      LIMIT 150`,
    [user.shopId, unreadOnly],
  );

  const totalUnread = threads.reduce((sum, thread) => sum + thread.unread, 0);

  // The open thread. Looked up on its own rather than from the list, so a
  // deep link to a customer with no messages yet still opens a composer.
  const current = selected
    ? (
        await query<{ id: string; full_name: string | null; phone: string; sms_opted_out: boolean }>(
          "SELECT id, full_name, phone, sms_opted_out FROM customers WHERE id = $1 AND shop_id = $2",
          [selected, user.shopId],
        )
      )[0] ?? null
    : null;
  const history = current
    ? await loadThread({ shopId: user.shopId, customerId: current.id })
    : [];

  const listHref = unreadOnly ? "/app/messages?unread=1" : "/app/messages";
  const threadHref = (id: string) => `${listHref}${unreadOnly ? "&" : "?"}customer=${id}`;

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Messages"
        description={
          totalUnread > 0
            ? `${totalUnread} unread from ${threads.filter((t) => t.unread > 0).length} customer${threads.filter((t) => t.unread > 0).length === 1 ? "" : "s"}.`
            : "Everything said to and by your customers, one thread each."
        }
      >
        <Link
          href={unreadOnly ? "/app/messages" : "/app/messages?unread=1"}
          className={`btn btn-sm ${unreadOnly ? "btn-primary" : "btn-ghost"}`}
        >
          {unreadOnly ? "Showing unread" : "Unread only"}
        </Link>
      </PageHead>

      {/*
        Two panes on a laptop. On a phone it is one or the other: the list,
        or — with a customer picked — the thread with a way back.
      */}
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <section className={`card overflow-hidden ${current ? "hidden lg:block" : ""}`}>
          {threads.length === 0 ? (
            <EmptyState
              title={unreadOnly ? "Nothing unread" : "No conversations yet"}
              detail={
                unreadOnly
                  ? "Every message from a customer has been seen."
                  : "Messages appear as ZOL keeps customers posted and as they write back."
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {threads.map((thread) => {
                const active = thread.customer_id === current?.id;
                return (
                  <li key={thread.customer_id}>
                    <Link
                      href={threadHref(thread.customer_id)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-paper-2 ${
                        active ? "bg-paper-2 shadow-[inset_3px_0_0_var(--emerald)]" : ""
                      }`}
                    >
                      <Avatar name={thread.customer_name} tone={thread.unread > 0 ? "person" : "neutral"} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`truncate text-[0.9375rem] ${thread.unread > 0 ? "font-semibold text-ink" : "font-medium text-ink"}`}>
                            {thread.customer_name ?? formatPhone(thread.phone)}
                          </span>
                          <span className="t-data flex-none text-[0.6875rem] text-ink-3">
                            {formatRelative(thread.last_at, user.timezone)}
                          </span>
                        </span>
                        <span className={`mt-0.5 block truncate text-[0.8125rem] ${thread.unread > 0 ? "text-ink" : "text-ink-2"}`}>
                          {thread.last_direction === "inbound"
                            ? ""
                            : thread.last_direction === "internal"
                              ? "Note: "
                              : "You: "}
                          {thread.last_body}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {thread.unread > 0 && <Tag tone="person">{thread.unread} new</Tag>}
                          {thread.open_tickets > 0 && (
                            <Tag tone="neutral">
                              {thread.open_tickets} open ticket{thread.open_tickets === 1 ? "" : "s"}
                            </Tag>
                          )}
                          {thread.sms_opted_out && <Tag tone="red">Texts stopped</Tag>}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={`card overflow-hidden ${current ? "" : "hidden lg:block"}`}>
          {current ? (
            <>
              <header className="flex items-center gap-3 border-b border-line px-4 py-3">
                <Link href={listHref} className="btn btn-ghost btn-sm lg:hidden" aria-label="Back to all conversations">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Avatar name={current.full_name} />
                <div className="min-w-0 flex-1">
                  <Link href={`/app/customers/${current.id}`} className="block truncate text-[0.9375rem] font-semibold text-ink hover:underline">
                    {current.full_name ?? "Unnamed"}
                  </Link>
                  <a href={`tel:${current.phone}`} className="t-data text-[0.8125rem] text-ink-2">
                    {formatPhone(current.phone)}
                  </a>
                </div>
                {current.sms_opted_out && <Tag tone="red">Texts stopped</Tag>}
              </header>
              <div className="max-h-[60vh] overflow-y-auto px-4 py-4">
                <MessageBubbles messages={history} timezone={user.timezone} showTicket />
              </div>
              <div className="border-t border-line px-4 py-4">
                <MessageComposer
                  customerId={current.id}
                  repairOrderId={null}
                  smsOptedOut={current.sms_opted_out}
                  returnTo={threadHref(current.id)}
                />
                <p className="mt-2 text-[0.75rem] text-ink-3">
                  Sent from here, a message isn&apos;t tied to a ticket. To write on a ticket&apos;s history, use the
                  conversation on the ticket itself.
                </p>
              </div>
            </>
          ) : (
            <EmptyState
              title="Pick a conversation"
              detail="The thread opens here with the whole history and a box to reply."
            />
          )}
        </section>
      </div>
    </>
  );
}
