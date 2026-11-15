import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage, LegalSection } from "@/components/site/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `Terms & Conditions | ${site.name}` },
  description: `Terms and conditions for using ${site.company.legalName}'s website and software, including the SMS terms for ZOL's customer support and account texts.`,
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

      <LegalSection title="6. SMS Terms: ZOL Support Texts">
        <p>
          <strong>Program description.</strong> {legalName} sends text messages to the auto
          repair shop owners and staff who are its customers, for customer support and account
          purposes: replies to your support requests, onboarding help, service and maintenance
          notices, and billing notices. These texts come from {legalName} about your{" "}
          {site.name} account. They are not marketing, and they are not texts to a
          shop&rsquo;s own customers.
        </p>
        <p>
          <strong>Opting in.</strong> You opt in by submitting the form on our{" "}
          <Link href={site.smsOptInPath}>SMS opt-in page</Link> with the consent box ticked, or
          by saying yes when a member of our team reads you the consent script on an onboarding
          call. We record the date, the channel and the wording you agreed to. Consent is not a
          condition of purchase.
        </p>
        <p>
          <strong>Message frequency varies.</strong> Typically a few messages a month, more
          while you are being onboarded or have an open support request.
        </p>
        <p>
          <strong>Msg &amp; data rates may apply.</strong> {legalName} does not charge for text
          messages; your mobile carrier&rsquo;s rates apply.
        </p>
        <p>
          <strong>Stop.</strong> Reply <strong>STOP</strong> to any message to unsubscribe. You
          will get one message confirming you are unsubscribed and no further texts. Reply{" "}
          <strong>START</strong> to resubscribe.
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
          <strong>Privacy.</strong> {legalName} does not sell or share your mobile number or
          SMS opt-in data with third parties or affiliates for marketing or promotional
          purposes. See our <Link href={site.privacyPath}>Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="7. Shop texting program">
        <p>
          Separately from the support texts above, a shop that uses {site.name} may text its
          own customers about their vehicle and visit. That program is registered per shop,
          the texts come from the shop, and its terms are set out on the{" "}
          <Link href={site.smsTermsPath}>shop SMS terms</Link> page, with the opt-in process
          shown at <Link href={site.shopSmsOptInPath}>{site.shopSmsOptInPath}</Link>. Nothing in
          section 6 applies to those texts, and nothing on that page applies to texts from{" "}
          {legalName} to its own customers.
        </p>
      </LegalSection>

      <LegalSection title="8. Intellectual property">
        <p>
          The Service, its software, design and content are owned by {legalName} and its
          licensors. We grant you a limited, non-exclusive, non-transferable right to use the
          Service under these terms. No other rights are granted.
        </p>
      </LegalSection>

      <LegalSection title="9. Disclaimers">
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

      <LegalSection title="10. Limitation of liability">
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

      <LegalSection title="11. Termination">
        <p>
          You may stop using the Service and close your account at any time. We may suspend
          or end your access if you break these terms, do not pay, or if we discontinue the
          Service, with notice where practical. Sections that by their nature should
          survive, including payment obligations, disclaimers and limitation of liability,
          survive termination.
        </p>
      </LegalSection>

      <LegalSection title="12. Changes">
        <p>
          We may update these terms. The date at the top shows when they last changed, and
          material changes will be posted here before they take effect. Continuing to use the
          Service after a change means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection title="13. Governing law">
        <p>
          These terms are governed by the laws of the State of Delaware, without regard to
          its conflict of laws rules. Any dispute that cannot be resolved informally will be
          brought in the state or federal courts located in Delaware, and you consent to
          their jurisdiction.
        </p>
      </LegalSection>

      <LegalSection title="14. Contact">
        <p>
          {legalName}, {city}, {region}.{" "}
          <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
