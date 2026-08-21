import Link from "next/link";

import { PageHead } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const metadata = { title: "Today" };

interface Counts {
  customers: string;
  open_ros: string;
  calls_today: string;
  staff: string;
  has_hours: boolean;
  twilio_number: string | null;
}

export default async function TodayPage(props: PageProps<"/app">) {
  const user = await requireUser();
  const { denied } = await props.searchParams;

  // One round trip. Each of these is a scalar the page needs at the top, and
  // five separate queries from a serverless function is five times the
  // latency for the same answer.
  const rows = await query<Counts>(
    `SELECT
       (SELECT count(*) FROM customers WHERE shop_id = $1)          AS customers,
       (SELECT count(*) FROM repair_orders
         WHERE shop_id = $1 AND status NOT IN ('closed','cancelled')) AS open_ros,
       (SELECT count(*) FROM calls
         WHERE shop_id = $1 AND started_at > now() - interval '24 hours') AS calls_today,
       (SELECT count(*) FROM staff WHERE shop_id = $1 AND disabled_at IS NULL) AS staff,
       (SELECT count(*) > 0 FROM shop_hours
         WHERE shop_id = $1 AND NOT is_closed)                      AS has_hours,
       (SELECT twilio_number FROM shops WHERE id = $1)              AS twilio_number`,
    [user.shopId],
  );

  const counts = rows[0];
  const first = user.fullName.split(" ")[0];

  return (
    <>
      <PageHead eyebrow={user.shopName} title={`Morning, ${first}`} />

      {/* Where requireRole() sends somebody who reached an owner-only screen —
          by a bookmark, or a link a colleague pasted. Saying so beats
          bouncing them here with no explanation. */}
      {denied && (
        <p
          role="status"
          className="mb-6 rounded-[var(--radius)] border border-amber-line bg-amber-wash px-3 py-2.5 text-[0.875rem] text-amber-deep"
        >
          That page is the owner&rsquo;s. Ask them if you need it.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Customers" value={counts.customers} href="/app/customers" />
        <Stat
          label="Open repair orders"
          value={counts.open_ros}
          href="/app/repair-orders"
        />
        <Stat label="Calls, last 24h" value={counts.calls_today} />
        <Stat label="People" value={counts.staff} />
      </div>

      <section className="card mt-6 p-5 sm:p-6">
        <h2 className="t-h3 text-[1.125rem]">Getting set up</h2>
        <p className="mt-1 text-[0.9375rem] text-ink-2">
          What&rsquo;s left before ZOL can answer a call for you.
        </p>

        <ul className="mt-4 flex flex-col divide-y divide-line border-t border-line">
          <Step
            done={Number(counts.staff) > 1}
            title="Add your advisors"
            body="Everyone who works the counter gets their own sign-in, so the board shows who did what."
            href="/app/team"
            cta="Invite someone"
          />
          <Step
            done={counts.has_hours}
            title="Set your hours"
            body="Calls inside your hours go to the counter. Outside them, ZOL picks up."
            href="/app/settings"
            cta="Check hours"
          />
          <Step
            done={Boolean(counts.twilio_number)}
            title="Connect your phone number"
            body="Waiting on carrier registration (A2P 10DLC). Nothing on your line changes until it clears and you switch it on."
          />
        </ul>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="t-eyebrow">{label}</p>
      <p className="t-num mt-2 text-[2rem]">{value}</p>
    </>
  );

  // A count is only a link once there's a screen behind it. The ones without
  // a destination stay plain rather than pretending.
  return href ? (
    <Link href={href} className="card p-4 transition-colors hover:bg-paper-2">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

function Step({
  done,
  title,
  body,
  href,
  cta,
}: {
  done: boolean;
  title: string;
  body: string;
  href?: string;
  cta?: string;
}) {
  return (
    <li className="flex flex-wrap items-start gap-3 py-4">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full border text-[0.625rem] font-bold ${
          done
            ? "border-emerald-line bg-emerald-wash text-emerald-deep"
            : "border-line-2 bg-paper-3 text-ink-3"
        }`}
      >
        {done ? "✓" : ""}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-semibold text-ink">
          {title}
          <span className="sr-only">{done ? " — done" : " — not done yet"}</span>
        </p>
        <p className="mt-0.5 text-[0.875rem] leading-relaxed text-ink-2">
          {body}
        </p>
      </div>
      {href && cta && !done && (
        <Link href={href} className="btn btn-ghost btn-sm">
          {cta}
        </Link>
      )}
    </li>
  );
}
