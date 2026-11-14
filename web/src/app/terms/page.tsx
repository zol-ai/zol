import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, LegalSection } from "@/components/site/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `Terms & Conditions | ${site.name}` },
  description: `Terms and conditions for using ${site.company.legalName}'s website and software, including the terms for text messages sent on behalf of auto repair shops.`,
  alternates: { canonical: site.termsPath },
};

const { legalName, city, region } = site.company;
const host = site.url.replace("https://", "");

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & conditions"
      effective="November 14, 2026"
      intro={
        <>
          <p className="t-data text-[0.8125rem] text-ink-3">Last updated: November 14, 2026</p>
          <p className="mt-4">
            These terms are an agreement between you and {legalName}, a Delaware corporation
            based in {city}, {region} (&ldquo;{site.name},&rdquo; &ldquo;we,&rdquo;
            &ldquo;us&rdquo;). They govern your use of {host}, the {site.name} application and
            the phone and text services we operate for auto repair shops (together, the
            &ldquo;Service&rdquo;). By using the Service you agree to them. If you do not
            agree, do not use the Service.
          </p>
        </>
      }
    >
      <LegalSection title="1. The Service">
        <p>
          {site.name} is front-desk software for independent auto repair shops. It answers
          calls, books appointments, writes repair orders, sends estimates, invoices and
          updates to a shop&rsquo;s customers, and keeps the record of the work. The Service is
          provided to shops; a shop&rsquo;s customers interact with it through calls, texts and
          links the shop sends them.
        </p>
      </LegalSection>

      <LegalSection title="2. Accounts">
        <p>
          A shop opens an account to use the Service. You must give accurate information,
          keep your sign-in credentials confidential, and tell us promptly at{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a> if you believe your
          account has been used without permission. You are responsible for activity under
          your account, including by staff you invite. You must be at least 18 and able to
          form a binding contract on behalf of the shop.
        </p>
      </LegalSection>

      <LegalSection title="3. Payment">
        <p>
          Paid features are billed at the price and on the schedule shown when you sign up or
          agreed with us in writing. Fees are in US dollars, exclusive of taxes, and charged
          to the payment method on file. Payments made through the Service to a shop (for
          example an invoice paid from a text link) are between the customer and the shop; we
          process them through a third-party payment processor and are not a party to the
          purchase of repair services. Unless the law requires otherwise, fees paid to us
          are non-refundable. We may change our prices with notice before the next billing
          period.
        </p>
      </LegalSection>

      <LegalSection title="4. Your content and data">
        <p>
          Shops own their customer records, messages and other data entered into the
          Service. You grant us the right to host, process and transmit that data as needed
          to run the Service and as described in our{" "}
          <Link href={site.privacyPath}>privacy policy</Link>. The shop is responsible for
          having the right to give us the customer information it enters, including consent
          to text its customers.
        </p>
      </LegalSection>

      <LegalSection title="5. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service to send messages a recipient has not consented to, or any
            unlawful, deceptive, harassing or unsolicited marketing content.</li>
          <li>Text a number after its owner has replied STOP or otherwise withdrawn consent.</li>
          <li>Enter false information, impersonate another person or shop, or use another
            account without permission.</li>
          <li>Interfere with the Service, probe or circumvent its security, scrape it, or
            reverse engineer it except where the law allows.</li>
          <li>Resell or sublicense the Service without our written agreement.</li>
          <li>Violate any applicable law, including telemarketing, consumer protection and
            privacy laws.</li>
        </ul>
        <p>We may suspend or close accounts that break these rules.</p>
      </LegalSection>

      <LegalSection title="6. SMS terms">
        <p>
          <strong>Program description.</strong> {legalName} runs the phone and text line for
          independent auto repair shops and sends text messages on a shop&rsquo;s behalf to
          that shop&rsquo;s customers. Texts are about your own vehicle and your visit to the
          shop: appointment confirmations and reminders, repair estimates and links to approve
          or decline the work, inspection results, parts and repair status updates, invoices
          and payment links, service follow-ups and maintenance reminders, and replies to
          texts you send the shop.
        </p>
        <p>
          <strong>Opting in.</strong> You agree to receive these texts when you give the shop
          your mobile number and agree to text updates &mdash; at the counter, on a call
          answered by {site.name}, on the shop&rsquo;s booking page, or by texting the
          shop&rsquo;s line first. Consent is not a condition of any purchase. How this works
          is shown step by step on our{" "}
          <Link href={site.smsOptInPath}>SMS opt-in page</Link>.
        </p>
        <p>
          <strong>Message frequency varies</strong> with your appointments and repairs,
          typically a few messages per visit.
        </p>
        <p>
          <strong>Msg &amp; data rates may apply.</strong> {site.name} and the shop do not
          charge for text messages; your mobile carrier&rsquo;s rates apply.
        </p>
        <p>
          <strong>Stop.</strong> Reply <strong>STOP</strong> to any message to unsubscribe. You
          will get one message confirming you are unsubscribed and no further texts from
          that shop line. Reply <strong>START</strong> to opt back in.
        </p>
        <p>
          <strong>Help.</strong> Reply <strong>HELP</strong> for help, or email{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
        </p>
        <p>
          <strong>Carriers.</strong> Carriers are not liable for delayed or undelivered
          messages.
        </p>
        <p>
          <strong>Privacy.</strong> We do not share or sell mobile numbers or text message
          opt-in data to third parties for marketing. See our{" "}
          <Link href={site.privacyPath}>privacy policy</Link> and the standalone{" "}
          <Link href={site.smsTermsPath}>SMS terms</Link>.
        </p>
      </LegalSection>

      <LegalSection title="7. Intellectual property">
        <p>
          The Service, its software, design and content are owned by {legalName} and its
          licensors. We grant you a limited, non-exclusive, non-transferable right to use the
          Service under these terms. No other rights are granted.
        </p>
      </LegalSection>

      <LegalSection title="8. Disclaimers">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo; To the
          fullest extent permitted by law, we disclaim all warranties, express or implied,
          including merchantability, fitness for a particular purpose and non-infringement.
          We do not warrant that the Service will be uninterrupted, error-free or that every
          call will be answered or every message delivered. {site.name} assists with shop
          communication and record keeping; the shop remains responsible for its repair work,
          its estimates and its dealings with its customers.
        </p>
      </LegalSection>

      <LegalSection title="9. Limitation of liability">
        <p>
          To the fullest extent permitted by law, {legalName} will not be liable for any
          indirect, incidental, special, consequential or punitive damages, or for lost
          profits, revenue, data or goodwill, arising from or related to the Service. Our
          total liability for all claims relating to the Service will not exceed the amount
          you paid us for the Service in the twelve months before the claim arose, or one
          hundred US dollars if you have paid nothing. Some jurisdictions do not allow these
          limits, so they may not apply to you.
        </p>
      </LegalSection>

      <LegalSection title="10. Termination">
        <p>
          You may stop using the Service and close your account at any time. We may suspend
          or end your access if you break these terms, do not pay, or if we discontinue the
          Service, with notice where practical. Sections that by their nature should
          survive, including payment obligations, disclaimers and limitation of liability,
          survive termination.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes">
        <p>
          We may update these terms. The date at the top shows when they last changed, and
          material changes will be posted here before they take effect. Continuing to use the
          Service after a change means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection title="12. Governing law">
        <p>
          These terms are governed by the laws of the State of Delaware, without regard to
          its conflict of laws rules. Any dispute that cannot be resolved informally will be
          brought in the state or federal courts located in Delaware, and you consent to
          their jurisdiction.
        </p>
      </LegalSection>

      <LegalSection title="13. Contact">
        <p>
          {legalName}, {city}, {region}.{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
