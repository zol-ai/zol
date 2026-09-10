import { PageHead } from "@/components/app/shell";
import { Notice, Tag } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { messagingStatus } from "@/lib/messaging/provider";
import { formatPhone } from "@/lib/phone";
import { requestOrigin } from "@/lib/request-origin";
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

  const [shops, hours, origin] = await Promise.all([
    query<ShopSettings & { twilio_number: string | null }>(
      `SELECT name, slug, timezone, bay_count, labor_rate_cents,
              parts_margin_pct, tax_rate_pct, auto_quote_cap_cents,
              address, public_phone, email, twilio_number
         FROM shops WHERE id = $1`,
      [user.shopId],
    ),
    query<DayHours>(
      `SELECT day_of_week, opens_at::text, closes_at::text, is_closed
         FROM shop_hours WHERE shop_id = $1 ORDER BY day_of_week`,
      [user.shopId],
    ),
    requestOrigin(),
  ]);

  const shop = shops[0];
  const publicLink = `${origin}/talk/${shop.slug}`;

  /*
    What is switched on, in the owner's words. Each of these is read from the
    environment the same way the feature itself reads it, so this card cannot
    say "on" for something the code would treat as off.
  */
  const messaging = messagingStatus();
  const integrations: {
    name: string;
    on: boolean;
    state: string;
    detail: string;
  }[] = [
    {
      name: "Texting",
      on: messaging.mode === "twilio",
      state: messaging.mode === "twilio" ? "Live" : "Portal only",
      detail:
        messaging.mode === "twilio"
          ? `Customers get texts from ${shop.twilio_number ? formatPhone(shop.twilio_number) : "the platform number"}.`
          : `${messaging.reason ?? "Texting is off."} Until then every message ZOL sends lands on the customer's repair page and in their message history, and you can call them from there.`,
    },
    {
      name: "Phone line",
      on: env.telephonyEnabled,
      state: env.telephonyEnabled ? "Live" : "Off",
      detail: env.telephonyEnabled
        ? shop.twilio_number
          ? `ZOL answers ${formatPhone(shop.twilio_number)}.`
          : "Telephony is switched on but this shop has no line assigned yet."
        : "ZOL isn't answering a phone line yet — it waits on carrier registration. The web receptionist at your public link works now.",
    },
    {
      name: "AI drafting and diagnostics",
      on: env.openai.configured,
      state: env.openai.configured ? "On" : "Templates",
      detail: env.openai.configured
        ? `Follow-up drafts, diagnostic rankings and inspection summaries come from the model (${env.openai.model}), checked against your data before anything is shown.`
        : "No AI key is configured. Drafts and summaries use ZOL's built-in templates and are labelled as such. Nothing is lost when the key is added — the same buttons start using the model.",
    },
    {
      name: "Card payments",
      on: env.stripe.configured,
      state: env.stripe.configured ? "Stripe" : "Demo",
      detail: env.stripe.configured
        ? "Customers pay from their repair page through Stripe Checkout. ZOL never sees a card number."
        : "No payment processor is connected. The portal records a clearly labelled demo payment so the rest of the flow works; cash and cheque are recorded at the counter as usual.",
    },
    {
      name: "Inspection photos",
      on: env.storage.configured,
      state: env.storage.configured ? "On" : "Off",
      detail: env.storage.configured
        ? "Techs can attach photos to inspection items and the customer sees them on their repair page."
        : "No photo storage is configured, so inspections run on notes and measurements. The upload controls appear once a bucket is set.",
    },
  ];

  return (
    <>
      <PageHead eyebrow={user.shopName} title="Settings" />

      {typeof saved === "string" && SAVED[saved] && (
        <Notice tone="zol" className="mb-6">
          <span className="font-semibold">{SAVED[saved]}</span>
        </Notice>
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
        <h2 className="t-h3 text-[1.125rem]">Your public link</h2>
        <p className="mt-1 text-[0.9375rem] text-ink-2">
          Where a customer talks to ZOL from the web — put it on your site, your
          Google listing, the card on the counter. The handle is fixed when the
          shop is created so old links keep working.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            href={publicLink}
            target="_blank"
            rel="noreferrer"
            className="t-data min-w-0 flex-1 truncate rounded-[var(--radius)] border border-line-2 bg-paper-2 px-3 py-2.5 text-[0.875rem] text-ink underline-offset-4 hover:underline"
          >
            {publicLink}
          </a>
          <span className="t-data text-[0.75rem] text-ink-3">handle: {shop.slug}</span>
        </div>
      </section>

      <section className="card mt-6 p-5 sm:p-6">
        <h2 className="t-h3 text-[1.125rem]">Integrations</h2>
        <p className="mt-1 text-[0.9375rem] text-ink-2">
          What ZOL is connected to right now. These are set up by ZOL, not from
          this screen; this is so you know what to expect.
        </p>
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {integrations.map((item) => (
            <li key={item.name} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-3">
              <span className="w-full text-[0.9375rem] font-semibold text-ink sm:w-52 sm:flex-none">
                {item.name}
              </span>
              <span className="order-first sm:order-none sm:pt-0.5">
                <Tag tone={item.on ? "zol" : "neutral"}>{item.state}</Tag>
              </span>
              <span className="min-w-0 flex-1 text-[0.875rem] leading-relaxed text-ink-2">
                {item.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>

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
