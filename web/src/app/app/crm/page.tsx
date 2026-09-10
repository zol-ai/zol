import Link from "next/link";
import { CircleDollarSign, Clock, Hourglass, Send } from "lucide-react";

import { findWinBacks } from "@/app/actions/follow-ups";
import { FollowUpList } from "@/components/app/crm/follow-up-list";
import { FollowUpNotices } from "@/components/app/crm/follow-up-notices";
import { listFollowUps } from "@/components/app/crm/follow-up-queries";
import { PageHead } from "@/components/app/shell";
import { MetricCard } from "@/components/app/ui";
import { aiConfigured } from "@/lib/ai/client";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatCents } from "@/lib/money";

export const metadata = { title: "Follow-ups" };

/**
 * The CRM: the shop's worklist of things to say to customers.
 *
 * Every card is a row in the outbound queue. The worker sends what is due on
 * its own; this screen is for the ones a person wants to read first, draft
 * better, send now, or close because they rang instead. Declined work has
 * its own list next door — it is the recall pipeline that feeds this one.
 */
export default async function CrmPage(props: PageProps<"/app/crm">) {
  const user = await requireUser();
  const params = await props.searchParams;
  const ai = aiConfigured();

  const [metrics, dueNow, scheduled, recentlySent, done] = await Promise.all([
    query<{
      due_now: string;
      scheduled: string;
      sent_week: string;
      declined_open_cents: string;
    }>(
      `SELECT
         (SELECT count(*) FROM follow_ups
           WHERE shop_id = $1 AND status = 'pending' AND scheduled_for <= now()) AS due_now,
         (SELECT count(*) FROM follow_ups
           WHERE shop_id = $1 AND status = 'pending' AND scheduled_for > now()) AS scheduled,
         (SELECT count(*) FROM follow_ups
           WHERE shop_id = $1 AND status = 'sent'
             AND sent_at >= now() - interval '7 days') AS sent_week,
         (SELECT coalesce(sum(estimated_cents), 0) FROM declined_work
           WHERE shop_id = $1 AND resolved_at IS NULL) AS declined_open_cents`,
      [user.shopId],
    ),
    listFollowUps(user.shopId, { when: "due", order: "scheduled", limit: 100 }),
    listFollowUps(user.shopId, { when: "scheduled", order: "scheduled", limit: 100 }),
    listFollowUps(user.shopId, { statuses: ["sent"], order: "recent", limit: 20 }),
    listFollowUps(user.shopId, {
      statuses: ["done", "cancelled", "failed"],
      order: "recent",
      limit: 20,
    }),
  ]);

  const m = metrics[0];

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Follow-ups"
        description="What ZOL is about to say to your customers, and what a person should say first."
      >
        <form action={findWinBacks}>
          <input type="hidden" name="return_to" value="/app/crm" />
          <button type="submit" className="btn btn-ghost btn-sm">
            Find win-backs
          </button>
        </form>
      </PageHead>

      <nav aria-label="CRM sections" className="mb-5 flex gap-1 border-b border-line">
        <span
          aria-current="page"
          className="border-b-2 border-emerald-deep px-3 py-2 text-[0.875rem] font-semibold text-ink"
        >
          Follow-ups
        </span>
        <Link
          href="/app/declined"
          className="px-3 py-2 text-[0.875rem] font-medium text-ink-2 hover:text-ink"
        >
          Declined work
        </Link>
      </nav>

      <FollowUpNotices params={params} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Due now"
          value={Number(m?.due_now ?? 0)}
          icon={Clock}
          tone={Number(m?.due_now ?? 0) > 0 ? "person" : "neutral"}
          detail="the worker's next pass"
        />
        <MetricCard label="Scheduled" value={Number(m?.scheduled ?? 0)} icon={Hourglass} />
        <MetricCard
          label="Sent, last 7 days"
          value={Number(m?.sent_week ?? 0)}
          icon={Send}
          tone="zol"
        />
        <MetricCard
          label="Declined work open"
          value={formatCents(Number(m?.declined_open_cents ?? 0))}
          icon={CircleDollarSign}
          href="/app/declined"
          detail="worth chasing"
        />
      </div>

      <div className="flex flex-col gap-8">
        <FollowUpList
          title="Due now"
          empty={
            <>
              Nothing waiting. Anything due goes out on the worker&rsquo;s next pass; anything
              you&rsquo;d rather read first shows up here before it does.
            </>
          }
          items={dueNow}
          timezone={user.timezone}
          returnTo="/app/crm"
          aiConfigured={ai}
        />

        <FollowUpList
          title="Scheduled"
          empty="Nothing scheduled ahead. Post-repair check-ins, inspection recommendations and birthdays land here as they're queued."
          items={scheduled}
          timezone={user.timezone}
          returnTo="/app/crm"
          aiConfigured={ai}
        />

        <FollowUpList
          title="Recently sent"
          empty="Nothing has gone out yet."
          items={recentlySent}
          timezone={user.timezone}
          returnTo="/app/crm"
          aiConfigured={ai}
        />

        <FollowUpList
          title="Done"
          empty="Nothing closed by hand yet. Marking a follow-up done records that somebody rang instead."
          items={done}
          timezone={user.timezone}
          returnTo="/app/crm"
          aiConfigured={ai}
        />
      </div>
    </>
  );
}
