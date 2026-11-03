import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, LegalSection } from "@/components/site/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${site.company.legalName} collects, uses and protects information, including mobile numbers and text message opt-in data.`,
  alternates: { canonical: site.privacyPath },
};

const { legalName, city, region } = site.company;

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      effective="November 3, 2026"
      intro={
        <p>
          {legalName} (&ldquo;{site.name},&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) makes
          shop management software for independent auto repair shops. This policy explains
          what information we collect through {site.url.replace("https://", "")}, the{" "}
          {site.name} app, and the phone and text lines we operate for shops, how we use it,
          and the choices you have.
        </p>
      }
    >
      <LegalSection title="1. Information we collect">
        <ul>
          <li>
            <strong>Shop accounts.</strong> Names, email addresses, phone numbers and business
            details of shop owners and staff who sign up for or use {site.name}.
          </li>
          <li>
            <strong>Shop customers.</strong> When a shop uses {site.name}, we process its
            customers&rsquo; names, phone numbers, email addresses, vehicle details,
            appointments, estimates, invoices and messages on the shop&rsquo;s behalf.
          </li>
          <li>
            <strong>Calls and texts.</strong> Phone numbers, call recordings and transcripts,
            and the content of text messages sent to or from a shop&rsquo;s {site.name} line,
            along with your text message opt-in and opt-out status.
          </li>
          <li>
            <strong>Waitlist and contact forms.</strong> The name, shop, phone number and
            email address you enter.
          </li>
          <li>
            <strong>Technical data.</strong> IP address, browser type and pages visited,
            collected automatically when you use the site.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="2. How we use information">
        <ul>
          <li>To provide the service: answering calls, booking appointments, sending
            estimates, approvals, reminders, invoices and follow-ups for a shop.</li>
          <li>To send text messages you have agreed to receive, as described in our{" "}
            <Link href={site.smsTermsPath}>SMS terms</Link>.</li>
          <li>To respond to you when you contact us or join the waitlist.</li>
          <li>To secure, maintain and improve {site.name}.</li>
          <li>To comply with law.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Mobile numbers and text messaging">
        <p>
          <strong>
            We do not share, sell, rent or trade mobile phone numbers or text message
            opt-in data and consent with any third parties or affiliates for marketing or
            promotional purposes.
          </strong>{" "}
          Text messaging originator opt-in data and consent will not be shared with any
          third parties, except the service providers (such as our telecommunications
          carrier and messaging provider) that deliver the messages on our behalf.
        </p>
        <p>
          You can stop texts at any time by replying <strong>STOP</strong>. Reply{" "}
          <strong>HELP</strong> for help. See the <Link href={site.smsTermsPath}>SMS terms</Link>{" "}
          for details.
        </p>
      </LegalSection>

      <LegalSection title="4. How we share information">
        <p>We do not sell personal information. We share it only:</p>
        <ul>
          <li>With the auto repair shop you are a customer of, which controls its own
            customer records in {site.name}.</li>
          <li>With service providers that run the service for us — cloud hosting,
            telephony and messaging, payment processing and AI processing — under contracts
            that limit their use of the data to providing services to us.</li>
          <li>When required by law, or to protect the rights, safety and property of
            {" "}{site.name}, our users or others.</li>
          <li>As part of a merger, acquisition or sale of assets, subject to this policy.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Retention and security">
        <p>
          We keep information for as long as an account is active or as needed to provide
          the service, meet legal obligations and resolve disputes. A shop can ask us to
          delete its data. We use encryption in transit, access controls and other
          safeguards appropriate to the data we hold; no system is perfectly secure.
        </p>
      </LegalSection>

      <LegalSection title="6. Your choices and rights">
        <p>
          You can ask to access, correct or delete your personal information by emailing{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>. If you are a
          customer of a shop that uses {site.name}, you can also contact the shop directly.
          California residents have the rights described in the California Consumer Privacy
          Act, and we will not discriminate against you for exercising them.
        </p>
      </LegalSection>

      <LegalSection title="7. Children">
        <p>
          {site.name} is not directed to children under 13, and we do not knowingly collect
          their personal information.
        </p>
      </LegalSection>

      <LegalSection title="8. Changes">
        <p>
          We may update this policy. The effective date at the top shows when it last
          changed; material changes will be posted here before they take effect.
        </p>
      </LegalSection>

      <LegalSection title="9. Contact">
        <p>
          {legalName}, {city}, {region}.{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
