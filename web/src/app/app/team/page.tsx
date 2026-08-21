import { headers } from "next/headers";

import { revokeInvite } from "@/app/actions/auth";
import { PageHead } from "@/components/app/shell";
import { requireRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { InviteForm } from "./invite-form";
import { InviteLink } from "./invite-link";

export const metadata = { title: "Team" };

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  advisor: "Advisor",
  tech: "Tech",
};

export default async function TeamPage(props: PageProps<"/app/team">) {
  const user = await requireRole("owner");
  const { invited } = await props.searchParams;

  const [staff, invites] = await Promise.all([
    query<{
      id: string;
      full_name: string;
      email: string;
      role: string;
      last_login_at: string | null;
      password_hash: string | null;
    }>(
      `SELECT id, full_name, email, role, last_login_at, password_hash
         FROM staff
        WHERE shop_id = $1 AND disabled_at IS NULL
        ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'advisor' THEN 1 ELSE 2 END,
                 full_name`,
      [user.shopId],
    ),
    query<{
      id: string;
      full_name: string;
      email: string;
      role: string;
      expires_at: string;
    }>(
      `SELECT id, full_name, email, role, expires_at
         FROM staff_invites
        WHERE shop_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
          AND expires_at > now()
        ORDER BY created_at DESC`,
      [user.shopId],
    ),
  ]);

  // Build the link against the host actually being used, so an invite created
  // on a preview deployment points at that preview rather than at production.
  const h = await headers();
  const origin =
    process.env.ZOL_PUBLIC_URL ??
    `https://${h.get("x-forwarded-host") ?? h.get("host")}`;

  return (
    <>
      <PageHead eyebrow="Your shop" title="Team" />

      {typeof invited === "string" && (
        <div className="mb-6">
          <InviteLink url={`${origin}/invite/${invited}`} />
        </div>
      )}

      <section className="card p-5 sm:p-6">
        <h2 className="t-h3 text-[1.125rem]">Invite someone</h2>
        <p className="mt-1 text-[0.9375rem] text-ink-2">
          They set their own password. You get a link to hand over — no email is
          sent.
        </p>
        <div className="mt-4">
          <InviteForm />
        </div>
      </section>

      {invites.length > 0 && (
        <section className="card mt-6 p-5 sm:p-6">
          <h2 className="t-h3 text-[1.125rem]">Waiting to join</h2>
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9375rem] font-semibold text-ink">
                    {invite.full_name}
                    <span className="ml-2 tag tag-neutral">
                      {ROLE_LABEL[invite.role] ?? invite.role}
                    </span>
                  </p>
                  <p className="t-data text-[0.8125rem] text-ink-3">
                    {invite.email} · expires{" "}
                    {new Date(invite.expires_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: user.timezone,
                    })}
                  </p>
                </div>
                <form action={revokeInvite}>
                  <input type="hidden" name="id" value={invite.id} />
                  <button className="btn btn-ghost btn-sm" type="submit">
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card mt-6 p-5 sm:p-6">
        <h2 className="t-h3 text-[1.125rem]">People</h2>
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {staff.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] font-semibold text-ink">
                  {person.full_name}
                  <span className="ml-2 tag tag-neutral">
                    {ROLE_LABEL[person.role] ?? person.role}
                  </span>
                  {person.id === user.staffId && (
                    <span className="ml-1.5 text-[0.8125rem] font-normal text-ink-3">
                      you
                    </span>
                  )}
                </p>
                <p className="t-data text-[0.8125rem] text-ink-3">
                  {person.email}
                </p>
              </div>
              <p className="text-[0.8125rem] text-ink-3">
                {person.last_login_at
                  ? `last in ${new Date(person.last_login_at).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", timeZone: user.timezone },
                    )}`
                  : person.password_hash
                    ? "never signed in"
                    : "no password set"}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
