import { PageHead } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  HoursForm,
  PasswordForm,
  ShopForm,
  type DayHours,
  type ShopSettings,
} from "./settings-forms";

export const metadata = { title: "Settings" };

const SAVED: Record<string, string> = {
  shop: "Shop settings saved.",
  hours: "Hours saved.",
  password: "Password changed. Every other session was signed out.",
};

export default async function SettingsPage(props: PageProps<"/app/settings">) {
  const user = await requireUser();
  const { saved } = await props.searchParams;
  const owner = user.role === "owner";

  const [shops, hours] = await Promise.all([
    query<ShopSettings>(
      `SELECT name, timezone, bay_count, labor_rate_cents,
              parts_margin_pct, tax_rate_pct, auto_quote_cap_cents
         FROM shops WHERE id = $1`,
      [user.shopId],
    ),
    query<DayHours>(
      `SELECT day_of_week, opens_at::text, closes_at::text, is_closed
         FROM shop_hours WHERE shop_id = $1 ORDER BY day_of_week`,
      [user.shopId],
    ),
  ]);

  const shop = shops[0];

  return (
    <>
      <PageHead eyebrow={user.shopName} title="Settings" />

      {typeof saved === "string" && SAVED[saved] && (
        <p
          role="status"
          className="mb-6 rounded-[var(--radius)] border border-emerald-line bg-emerald-wash px-3 py-2.5 text-[0.875rem] font-semibold text-emerald-deep"
        >
          {SAVED[saved]}
        </p>
      )}

      {owner && (
        <>
          <section className="card p-5 sm:p-6">
            <h2 className="t-h3 text-[1.125rem]">Shop and pricing</h2>
            <p className="mt-1 text-[0.9375rem] text-ink-2">
              These are the numbers ZOL is allowed to quote with. Nothing goes
              to a customer at a rate you didn&rsquo;t set here.
            </p>
            <div className="mt-4">
              <ShopForm shop={shop} />
            </div>
          </section>

          <section className="card mt-6 p-5 sm:p-6">
            <h2 className="t-h3 text-[1.125rem]">Hours</h2>
            <p className="mt-1 text-[0.9375rem] text-ink-2">
              Inside these, a call goes to your counter. Outside them, ZOL picks
              up. They also bound what appointment times it may offer.
            </p>
            <div className="mt-4">
              <HoursForm hours={hours} />
            </div>
          </section>
        </>
      )}

      <section className="card mt-6 p-5 sm:p-6">
        <h2 className="t-h3 text-[1.125rem]">Your password</h2>
        <div className="mt-4">
          <PasswordForm />
        </div>
      </section>

      {!owner && (
        <p className="mt-6 text-[0.875rem] text-ink-3">
          Shop settings, pricing and hours are the owner&rsquo;s to change.
        </p>
      )}
    </>
  );
}
