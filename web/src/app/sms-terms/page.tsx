import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, LegalSection } from "@/components/site/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `Shop SMS Terms | ${site.name}` },
  description: `The shop texting program: terms for text messages an auto repair shop using ${site.name} sends to its own customers. Registered per shop, separately from ZOL INC's support texts.`,
  alternates: { canonical: site.smsTermsPath },
};

const { legalName } = site.company;

export default function SmsTermsPage() {
  return (
    <LegalPage
      title="SMS terms: shop texting program"
      effective="November 3, 2026"
      intro={
        <>
          <p>
            {legalName} (&ldquo;{site.name}&rdquo;) makes front-desk software for independent
            auto repair shops. These terms cover the <strong>shop texting program</strong>: the
            text messages a shop sends, using {site.name}, to that shop&rsquo;s own customers
            about their vehicle and visit. Each shop registers this program for its own
            number.
          </p>
          <p className="mt-4 rounded-md border border-line bg-paper-2 px-4 py-3 text-[0.875rem]">
            Texts from {legalName} to its own customers (shop owners and staff) for support and
            account purposes are a separate program, covered in the SMS section of our{" "}
            <Link href={site.termsPath}>Terms &amp; Conditions</Link> and opted into at{" "}
            <Link href={site.smsOptInPath}>{site.smsOptInPath}</Link>.
          </p>
        </>
      }
    >
      <LegalSection title="What the texts are for">
        <p>Texts are about your own vehicle and your visit to the shop:</p>
        <ul>
          <li>Appointment confirmations and reminders</li>
          <li>Repair estimates and links to approve or decline the work</li>
          <li>Inspection results, parts and repair status updates</li>
          <li>Invoices and payment links</li>
          <li>Service follow-ups and maintenance reminders</li>
          <li>Replies to texts you send the shop</li>
        </ul>
      </LegalSection>

      <LegalSection title="How you opt in">
        <p>
          You agree to receive these texts when you give the shop your mobile number and
          agree to text updates — at the counter, on a call answered by {site.name}, on the
          shop&rsquo;s booking page, or by texting the shop&rsquo;s line first. Consent is
          not a condition of any purchase. The process is shown step by step at{" "}
          <Link href={site.shopSmsOptInPath}>{site.shopSmsOptInPath}</Link>.
        </p>
      </LegalSection>

      <LegalSection title="Message frequency">
        <p>
          Message frequency varies with your appointments and repairs, typically a few
          messages per visit.
        </p>
      </LegalSection>

      <LegalSection title="Cost">
        <p>
          <strong>Msg &amp; data rates may apply.</strong> {site.name} and the shop do not
          charge for text messages; your mobile carrier&rsquo;s rates apply.
        </p>
      </LegalSection>

      <LegalSection title="Stop and help">
        <p>
          Reply <strong>STOP</strong> to any message to unsubscribe. You will get one
          message confirming you are unsubscribed and no further texts from that shop line.
          Reply <strong>START</strong> to opt back in.
        </p>
        <p>
          Reply <strong>HELP</strong> for help, or email{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
        </p>
      </LegalSection>

      <LegalSection title="Carriers">
        <p>
          Carriers are not liable for delayed or undelivered messages.
        </p>
      </LegalSection>

      <LegalSection title="Privacy">
        <p>
          We do not share or sell mobile numbers or text message opt-in data to third
          parties for marketing. See our <Link href={site.privacyPath}>privacy policy</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
