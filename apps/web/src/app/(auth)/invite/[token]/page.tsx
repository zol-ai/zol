import type { Metadata } from "next";
import Link from "next/link";

import { hashToken } from "@/lib/auth";
import { query } from "@/lib/db";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = {
  title: "Join your shop",
  robots: { index: false, follow: false },
};

const ROLE_COPY: Record<string, string> = {
  owner: "an owner",
  advisor: "a service advisor",
  tech: "a technician",
};

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;

  const rows = await query<{
    email: string;
    full_name: string;
    role: string;
    shop_name: string;
  }>(
    `SELECT i.email, i.full_name, i.role, s.name AS shop_name
       FROM staff_invites i
       JOIN shops s ON s.id = i.shop_id
      WHERE i.token_hash = $1
        AND i.accepted_at IS NULL
        AND i.revoked_at IS NULL
        AND i.expires_at > now()`,
    [hashToken(token)],
  );

  const invite = rows[0];

  if (!invite) {
    return (
      <div className="card p-6 sm:p-8">
        <h1 className="t-h3 text-[1.5rem]">That link is no good</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          Invites last two weeks and can only be used once. Ask whoever runs the
          shop&rsquo;s ZOL account for a fresh one.
        </p>
        <p className="mt-6 border-t border-line pt-5 text-[0.875rem] text-ink-2">
          Already have an account?{" "}
          <Link
            href="/signin"
            className="font-semibold text-emerald-deep underline underline-offset-2"
          >
            Sign in
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="card p-6 sm:p-8">
      <h1 className="t-h3 text-[1.5rem]">Join {invite.shop_name}</h1>
      <p className="mt-1.5 text-[0.9375rem] text-ink-2">
        You&rsquo;ve been added as {ROLE_COPY[invite.role] ?? invite.role} on{" "}
        <span className="t-data text-ink">{invite.email}</span>. Pick a password
        and you&rsquo;re in.
      </p>

      <div className="mt-6">
        <AcceptForm token={token} fullName={invite.full_name} />
      </div>
    </div>
  );
}
