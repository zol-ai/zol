import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { ConsentCard, MockupFrame, PhoneMockup } from "@/components/site/sms-mockups";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `Shop SMS Opt-In Process | ${site.name}` },
  description: `The shop texting program: how an auto repair shop's customers opt in to texts about their vehicle, what they receive, and how they opt out. Registered per shop, separately from ZOL INC's own support texts.`,
  alternates: { canonical: site.shopSmsOptInPath },
};

const { legalName } = site.company;

/*
  Every message below is the exact copy the product sends. If the wording
  changes in the messaging code, change it here in the same commit: carrier
  reviewers compare this page against live traffic.
*/
const CONSENT_SCRIPT =
  "Can we text you appointment confirmations, estimates, repair updates and invoices for your vehicle at this number? Message frequency varies, msg and data rates may apply. Reply STOP to opt out or HELP for help. Do we have your permission?";

const CONFIRMATION_TEXT = `${legalName}: You're now opted in to text updates about your vehicle from your repair shop. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;

const UPDATE_TEXT =
  "[Shop Name] via ZOL: Your estimate for the [Vehicle] is ready. Total: $[Amount]. Review and approve or decline here: [Estimate Link]. Questions? Call [Shop Phone]. Reply STOP to opt out.";

const STOP_REPLY = `${legalName}: You've been unsubscribed and will receive no further texts from this number. Reply START to resubscribe.`;

const HELP_REPLY = `${legalName}: For help with texts from your repair shop, email ${site.contactEmail}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`;

const SHOP_LABEL = "Example of what a shop's customers see";

const linkClass =
  "font-semibold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink";

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line pt-10">
      <p className="t-eyebrow">{number}</p>
      <h2 className="t-h3 mt-3 text-[1.375rem] sm:text-[1.625rem]">{title}</h2>
      <div className="mt-5 space-y-4 text-[0.9375rem] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

function Step({
  number,
  title,
  children,
  figure,
}: {
  number: string;
  title: string;
  children: ReactNode;
  figure: ReactNode;
}) {
  return (
    <li className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-center">
      <div>
        <p className="t-num text-[2.5rem] text-ink-3/60">{number}</p>
        <h3 className="t-h3 mt-2 text-[1.125rem]">{title}</h3>
        <div className="mt-3 space-y-3 text-[0.9375rem] leading-relaxed text-ink-2">{children}</div>
      </div>
      {figure}
    </li>
  );
}

export default function SmsOptInPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Nav />

      <main id="main" className="flex-1">
        <section className="band">
          <div className="shell">
            <div className="max-w-4xl">
              <p className="t-eyebrow">Shop program · Text messaging</p>
              <h1 className="t-h2 mt-4 text-[2rem] sm:text-[2.625rem]">Shop SMS opt-in process</h1>
              <p className="t-data mt-4 text-[0.8125rem] text-ink-3">
                Last updated November 14, 2026 · {legalName}
              </p>
              <div className="mt-6 max-w-3xl text-[1rem] leading-relaxed text-ink-2">
                <p>
                  {legalName} provides front-desk software for independent auto repair shops.
                  Shops using {site.name} text their customers about their own vehicle and
                  visit. This page shows how customers opt in and how they opt out.
                </p>
                <p className="mt-4 rounded-md border border-line bg-paper-2 px-4 py-3 text-[0.875rem]">
                  <strong className="text-ink">This is the shop program.</strong> Each shop
                  registers its own texting campaign, and the texts described here come from
                  the shop to its own customers. {legalName}&rsquo;s separate program, in which
                  ZOL texts the shop owners and staff who are its customers for support and
                  account messages, is described at{" "}
                  <Link href={site.smsOptInPath} className={linkClass}>
                    {site.smsOptInPath}
                  </Link>
                  .
                </p>
              </div>

              <div className="mt-12 space-y-12">
                <Section number="01" title="How customers opt in (verbal consent)">
                  <p>
                    Consent is collected verbally when a customer gives their mobile number at
                    the shop counter or on a phone call answered by {site.name} for the shop.
                    Before saving the number, staff or {site.name}&rsquo;s phone assistant reads
                    this script word for word:
                  </p>
                  <blockquote className="rounded-md border border-emerald-line bg-emerald-wash px-5 py-4 text-[1rem] leading-relaxed font-medium text-ink">
                    &ldquo;{CONSENT_SCRIPT}&rdquo;
                  </blockquote>
                  <p>
                    The number is saved for texting only if the customer says yes. The consent,
                    date and channel are recorded on the customer&rsquo;s record. Consent is not
                    a condition of any purchase.
                  </p>
                </Section>

                <Section number="02" title="Step-by-step">
                  <ol className="space-y-14 pt-2">
                    <Step
                      number="1"
                      title="The customer is asked and says yes"
                      figure={
                        <MockupFrame label={SHOP_LABEL} exportId="shop-step-1">
                          <ConsentCard script={CONSENT_SCRIPT} />
                        </MockupFrame>
                      }
                    >
                      <p>
                        At the counter, or on a call answered by {site.name}, the customer gives
                        a mobile number. The script above is read in full, and the number is
                        saved for texting only on a clear yes. The consent, the date and the
                        channel (counter or call) are written to the customer&rsquo;s record.
                      </p>
                    </Step>

                    <Step
                      number="2"
                      title="The customer receives a confirmation text"
                      figure={
                        <MockupFrame label={SHOP_LABEL} exportId="shop-step-2">
                          <PhoneMockup
                            sender={legalName}
                            bubbles={[{ from: "sender", text: CONFIRMATION_TEXT }]}
                          />
                        </MockupFrame>
                      }
                    >
                      <p>
                        Right after opting in, the customer gets one confirmation message. It
                        names {legalName}, says what the texts are about, that message frequency
                        varies and that message and data rates may apply, and repeats the HELP
                        and STOP instructions.
                      </p>
                    </Step>

                    <Step
                      number="3"
                      title="Updates about the customer's own vehicle"
                      figure={
                        <MockupFrame label={SHOP_LABEL} exportId="shop-step-3">
                          <PhoneMockup
                            sender="[Shop Name]"
                            bubbles={[{ from: "sender", text: UPDATE_TEXT }]}
                          />
                        </MockupFrame>
                      }
                    >
                      <p>
                        From then on, texts are about the customer&rsquo;s own vehicle and visit:
                        appointment confirmations, estimates to approve or decline, repair
                        updates and invoices. Each one identifies the shop, is sent via{" "}
                        {site.name}, and ends with the STOP instruction. Bracketed values are
                        placeholders filled in per shop, vehicle and job.
                      </p>
                    </Step>
                  </ol>
                </Section>

                <Section number="03" title="Opting out and getting help">
                  <p>
                    Every message accepts the standard keywords. Replying <strong>STOP</strong>{" "}
                    unsubscribes the customer immediately and triggers one final confirmation;
                    replying <strong>HELP</strong> returns contact information. Replying{" "}
                    <strong>START</strong>, <strong>YES</strong> or <strong>UNSTOP</strong> opts
                    the customer back in.
                  </p>
                  <div className="grid gap-8 pt-2 sm:grid-cols-2">
                    <MockupFrame label={SHOP_LABEL} exportId="shop-opt-out-stop">
                      <PhoneMockup
                        sender={legalName}
                        bubbles={[
                          { from: "customer", text: "STOP" },
                          { from: "sender", text: STOP_REPLY },
                        ]}
                      />
                    </MockupFrame>
                    <MockupFrame label={SHOP_LABEL} exportId="shop-help">
                      <PhoneMockup
                        sender={legalName}
                        bubbles={[
                          { from: "customer", text: "HELP" },
                          { from: "sender", text: HELP_REPLY },
                        ]}
                      />
                    </MockupFrame>
                  </div>
                </Section>

                <section className="border-t border-line pt-8 text-[0.9375rem] leading-relaxed text-ink-2">
                  <p className="font-semibold text-ink">
                    Mobile numbers and opt-in data are never shared or sold to third parties for
                    marketing.
                  </p>
                  <p className="mt-3">
                    See the{" "}
                    <Link href={site.privacyPath} className={linkClass}>
                      privacy policy
                    </Link>
                    , the{" "}
                    <Link href={site.smsTermsPath} className={linkClass}>
                      SMS terms
                    </Link>{" "}
                    and the{" "}
                    <Link href={site.termsPath} className={linkClass}>
                      terms &amp; conditions
                    </Link>
                    . Questions:{" "}
                    <a href={`mailto:${site.contactEmail}`} className={linkClass}>
                      {site.contactEmail}
                    </a>
                    .
                  </p>
                  <p className="t-data mt-4 text-[0.75rem] text-ink-3">
                    All mockups on this page use placeholder shop data. No real customer names or
                    numbers appear. Shop program only; see {site.smsOptInPath} for ZOL INC&rsquo;s
                    own support texts.
                  </p>
                </section>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
