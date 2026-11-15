import { RecentActivity } from "@/components/app/dashboard/activity";
import { AttentionList } from "@/components/app/dashboard/attention";
import { DashboardMetrics } from "@/components/app/dashboard/metrics";
import { PipelineStrip } from "@/components/app/dashboard/pipeline";
import { SetupChecklist } from "@/components/app/dashboard/setup";
import { TodayList } from "@/components/app/dashboard/today";
import { TechnicianWorkload } from "@/components/app/dashboard/workload";
import { PageHead } from "@/components/app/shell";
import { Notice } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { greetingFor, loadDashboard, monthName } from "@/lib/dashboard";
import { longDate, zonedDate } from "@/lib/schedule";

export const metadata = { title: "Today" };

/**
 * The screen the owner opens first, usually on a phone, usually before the
 * first car arrives. Everything on it answers one of three questions: what
 * is coming in today, what is waiting on a person, and how the shop is
 * doing. Two round trips to the database (lib/dashboard.ts); nothing here
 * fetches on its own.
 */
export default async function TodayPage(props: PageProps<"/app">) {
  const user = await requireUser();
  const { denied } = await props.searchParams;

  const now = new Date();
  const today = zonedDate(now, user.timezone);
  const dashboard = await loadDashboard(user.shopId, user.timezone);
  const first = user.fullName.split(" ")[0];

  return (
    <>
      <PageHead
        eyebrow={longDate(today, user.timezone)}
        title={`${greetingFor(now, user.timezone)}, ${first}`}
        description={user.shopName}
      />

      {/* Where requireRole() sends somebody who reached an owner-only screen —
          by a bookmark, or a link a colleague pasted. Saying so beats
          bouncing them here with no explanation. */}
      {denied && (
        <Notice tone="person" className="mb-6">
          That page is the owner&rsquo;s. Ask them if you need it.
        </Notice>
      )}

      <div className="flex flex-col gap-6">
        <DashboardMetrics metrics={dashboard.metrics} month={monthName(now, user.timezone)} />

        <SetupChecklist setup={dashboard.setup} />

        {/* Today and the attention list take the wide column: they are the
            two lists the owner acts on. The strip, the techs and the feed
            are glanced at, and stack on the right on a laptop. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <TodayList
              appointments={dashboard.appointments}
              date={today}
              timezone={user.timezone}
            />
            <AttentionList items={dashboard.attention} timezone={user.timezone} />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <PipelineStrip counts={dashboard.pipeline} />
            <TechnicianWorkload technicians={dashboard.workload} />
            <RecentActivity items={dashboard.activity} timezone={user.timezone} />
          </div>
        </div>
      </div>
    </>
  );
}
