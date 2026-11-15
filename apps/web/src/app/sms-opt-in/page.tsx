import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { ConsentCard, MockupFrame, PhoneMockup } from "@/components/site/sms-mockups";
import { SmsOptInForm } from "@/components/site/sms-opt-in-form";
import { site } from "@/lib/site";
import {
  SMS_CALL_SCRIPT,
  SMS_CONFIRMATION,
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
  SMS_HELP,
  SMS_SAMPLE_THREAD,
  SMS_STOP,
} from "@/lib/sms-consent";

export const metadata: Metadata = {
  title: { absolute: `SMS Opt-In Process | ${site.name}` },
  description: `How auto repair shop owners and staff opt in to customer support and account text messages from ${site.company.legalName}, what they receive, and how they opt out.`,
  alternates: { canonical: site.smsOptInPath },
};

const { legalName } = site.company;
const SENDER = "ZOL INC";

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
              <p className="t-eyebrow">Text messaging · {legalName} support program</p>
              <h1 className="t-h2 mt-4 text-[2rem] sm:text-[2.625rem]">SMS opt-in process</h1>
              <p className="t-data mt-4 text-[0.8125rem] text-ink-3">
                Last updated November 14, 2026 · consent text v{SMS_CONSENT_VERSION}
              </p>
              <div className="mt-6 max-w-3xl space-y-4 text-[1rem] leading-relaxed text-ink-2">
                <p>
                  {legalName} provides front-desk software for independent auto repair shops.
                  This page covers the text messages {legalName} sends to its <strong>own
                  customers</strong>: the shop owners and staff who use {site.name}. These are
                  customer support and account messages, such as replies to support requests,
                  onboarding help, service and maintenance notices, and billing notices. This
                  page shows how those customers opt in, what they receive, and how they opt
                  out.
                </p>
                <p className="rounded-md border border-line bg-paper-2 px-4 py-3 text-[0.875rem]">
                  {legalName} does not text a shop&rsquo;s customers under this program. A shop
                  texting its own vehicle owners is a separate program, registered per shop,
                  described at{" "}
                  <Link href={site.shopSmsOptInPath} className={linkClass}>
                    {site.shopSmsOptInPath}
                  </Link>
                  .
                </p>
              </div>

              <div className="mt-12 space-y-12">
                <Section number="01" title="Opt in online">
                  <p>
                    A shop owner or staff member opts in by filling in the form below and
                    ticking the consent box, which is never pre-ticked. The form will not submit
                    with the box clear. On submit, {legalName} stores the number, the name and
                    shop given, the exact consent wording and its version, the date and time, the
                    IP address and browser, and notifies {site.contactEmail}. No text message is
                    sent at this step.
                  </p>
                  <div className="pt-2">
                    <SmsOptInForm />
                  </div>
                  <p className="t-eyebrow text-[0.625rem]">
                    This form is live. It records consent and sends no text.
                  </p>
                </Section>

                <Section number="02" title="Opt in on an onboarding call (verbal consent)">
                  <p>
                    Consent may also be given verbally when a shop owner or staff member gives
                    their mobile number on an onboarding or support call with a member of the{" "}
                    {site.name} team. Before saving the number, the team member reads this script
                    word for word:
                  </p>
                  <blockquote className="rounded-md border border-emerald-line bg-emerald-wash px-5 py-4 text-[1rem] leading-relaxed font-medium text-ink">
                    &ldquo;{SMS_CALL_SCRIPT}&rdquo;
                  </blockquote>
                  <p>
                    The number is saved for texting only if the person says yes. The consent,
                    the date, the channel (call) and the script version are recorded against
                    the number. Consent is not a condition of any purchase.
                  </p>
                  <MockupFrame exportId="call-script" className="pt-2">
                    <ConsentCard
                      script={SMS_CALL_SCRIPT}
                      heading="Onboarding call · ZOL team"
                      recorded="Consent recorded · verbal · call · 2026-11-14 09:41"
                      record={`Consent log · (555) 010-0100 · text v${SMS_CONSENT_VERSION}`}
                    />
                  </MockupFrame>
                </Section>

                <Section number="03" title="Step-by-step">
                  <ol className="space-y-14 pt-2">
                    <Step
                      number="1"
                      title="The customer opts in"
                      figure={
                        <MockupFrame exportId="step-1">
                          <ConsentCard
                            script={SMS_CONSENT_TEXT}
                            heading="Web form · tryzol.com/sms-opt-in"
                            recorded="Consent recorded · web form · 2026-11-14 09:41"
                            record={`Consent log · (555) 010-0100 · text v${SMS_CONSENT_VERSION} · IP logged`}
                          />
                        </MockupFrame>
                      }
                    >
                      <p>
                        Online, by ticking the consent box on the form above; or verbally, by
                        saying yes to the script on a call. Either way the consent wording, its
                        version, the date and the channel are written to {legalName}&rsquo;s
                        consent log before the number can be texted.
                      </p>
                    </Step>

                    <Step
                      number="2"
                      title="The customer receives a confirmation text"
                      figure={
                        <MockupFrame exportId="step-2">
                          <PhoneMockup
                            sender={SENDER}
                            bubbles={[{ from: "sender", text: SMS_CONFIRMATION }]}
                          />
                        </MockupFrame>
                      }
                    >
                      <p>
                        One confirmation message, sent from {legalName}&rsquo;s support number
                        once the number is opted in. It names {legalName}, says what the texts
                        are about, that message frequency varies and that message and data rates
                        may apply, and repeats the HELP and STOP instructions.
                      </p>
                    </Step>

                    <Step
                      number="3"
                      title="Support and account texts"
                      figure={
                        <MockupFrame exportId="step-3">
                          <PhoneMockup
                            sender={`${SENDER} Support`}
                            bubbles={SMS_SAMPLE_THREAD.map((b) => ({
                              from: b.from === "zol" ? "sender" : "customer",
                              text: b.text,
                            }))}
                          />
                        </MockupFrame>
                      }
                    >
                      <p>
                        From then on, texts are about the customer&rsquo;s own {site.name}{" "}
                        account: replies to their support requests, onboarding help, service and
                        maintenance notices, and billing notices. A sample support exchange is
                        shown. Every message identifies {legalName} and carries the STOP
                        instruction.
                      </p>
                    </Step>
                  </ol>
                </Section>

                <Section number="04" title="Opting out and getting help">
                  <p>
                    Every message accepts the standard keywords. Replying <strong>STOP</strong>{" "}
                    unsubscribes the number immediately, records the opt-out with the date and
                    channel, and triggers one final confirmation. Replying <strong>HELP</strong>{" "}
                    returns contact information. Replying <strong>START</strong>,{" "}
                    <strong>YES</strong> or <strong>UNSTOP</strong> opts the number back in and
                    sends the confirmation text again.
                  </p>
                  <div className="grid gap-8 pt-2 sm:grid-cols-2">
                    <MockupFrame exportId="opt-out-stop">
                      <PhoneMockup
                        sender={SENDER}
                        bubbles={[
                          { from: "customer", text: "STOP" },
                          { from: "sender", text: SMS_STOP },
                        ]}
                      />
                    </MockupFrame>
                    <MockupFrame exportId="help">
                      <PhoneMockup
                        sender={SENDER}
                        bubbles={[
                          { from: "customer", text: "HELP" },
                          { from: "sender", text: SMS_HELP },
                        ]}
                      />
                    </MockupFrame>
                  </div>
                </Section>

                <Section number="05" title="How consent is recorded">
                  <ul className="ml-5 list-disc space-y-1.5 pl-1">
                    <li>Mobile number, in E.164 format.</li>
                    <li>Name and shop name, as given.</li>
                    <li>Channel: web form, phone call, or a START or STOP keyword by text.</li>
                    <li>The exact consent wording shown or read, and its version
                      (currently v{SMS_CONSENT_VERSION}).</li>
                    <li>Date and time of the consent or the opt-out.</li>
                    <li>For the web form, the IP address and browser of the submission.</li>
                  </ul>
                  <p>
                    The log is append-only: an opt-out does not erase the opt-in, and a later
                    opt-in does not erase the opt-out. The current state of a number is its most
                    recent entry. Nothing is sent to a number whose most recent entry is an
                    opt-out.
                  </p>
                </Section>

                <section className="border-t border-line pt-8 text-[0.9375rem] leading-relaxed text-ink-2">
                  <p className="font-semibold text-ink">
                    {legalName} does not sell or share your mobile number or SMS opt-in data with
                    third parties or affiliates for marketing or promotional purposes.
                  </p>
                  <p className="mt-3">
                    See the{" "}
                    <Link href={site.privacyPath} className={linkClass}>
                      Privacy Policy
                    </Link>{" "}
                    and the SMS section of the{" "}
                    <Link href={site.termsPath} className={linkClass}>
                      Terms &amp; Conditions
                    </Link>
                    . Questions:{" "}
                    <a href={`mailto:${site.contactEmail}`} className={linkClass}>
                      {site.contactEmail}
                    </a>
                    .
                  </p>
                  <p className="t-data mt-4 text-[0.75rem] text-ink-3">
                    All mockups on this page use placeholder data. No real names or numbers
                    appear.
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
