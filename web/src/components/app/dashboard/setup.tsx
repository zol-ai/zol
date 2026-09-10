import Link from "next/link";

import type { SetupState } from "@/lib/dashboard";

/**
 * What's left before ZOL can answer a call. Shown only while a step is
 * outstanding; a finished checklist is clutter on a screen the owner reads
 * every morning.
 */
export function SetupChecklist({ setup }: { setup: SetupState }) {
  if (setup.complete) return null;

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="t-h3 text-[1.125rem]">Getting set up</h2>
      <p className="mt-1 text-[0.9375rem] text-ink-2">
        What&rsquo;s left before ZOL can answer a call for you.
      </p>

      <ul className="mt-4 flex flex-col divide-y divide-line border-t border-line">
        <Step
          done={setup.staff > 1}
          title="Add your advisors"
          body="Everyone who works the counter gets their own sign-in, so the board shows who did what."
          href="/app/team"
          cta="Invite someone"
        />
        <Step
          done={setup.hasHours}
          title="Set your hours"
          body="Calls inside your hours go to the counter. Outside them, ZOL picks up."
          href="/app/settings"
          cta="Check hours"
        />
        <Step
          done={Boolean(setup.twilioNumber)}
          title="Connect your phone number"
          body="Waiting on carrier registration (A2P 10DLC). Nothing on your line changes until it clears and you switch it on."
        />
      </ul>
    </section>
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
        <p className="mt-0.5 text-[0.875rem] leading-relaxed text-ink-2">{body}</p>
      </div>
      {href && cta && !done && (
        <Link href={href} className="btn btn-ghost btn-sm">
          {cta}
        </Link>
      )}
    </li>
  );
}
