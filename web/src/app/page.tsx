import type { Metadata } from "next";
import { BoardSection } from "@/components/site/board-section";
import { Cta } from "@/components/site/cta";
import { Faq } from "@/components/site/faq";
import { Footer } from "@/components/site/footer";
import { Founders } from "@/components/site/founders";
import { Hero } from "@/components/site/hero";
import { HowItWorks } from "@/components/site/how-it-works";
import { LostCalls } from "@/components/site/lost-calls";
import { Nav } from "@/components/site/nav";
import { OneRecord } from "@/components/site/one-record";
import { Product } from "@/components/site/product";
import { Reveal } from "@/components/site/reveal";
import { RunsItself } from "@/components/site/runs-itself";
import { Stats } from "@/components/site/stats";
import { WhySwitch } from "@/components/site/why-switch";
import { productScreens } from "@/lib/product";
import { site } from "@/lib/site";
import { founders } from "@/lib/team";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/*
  Two nodes: the product, and the company behind it with its founders. The
  founders carry `sameAs` links to their public profiles, so the people named
  on the page are the same people a crawler can find elsewhere — the machine
  side of what the Founders section does for a human reader. The product
  carries its screenshots and the sign-up URL, so a crawler can see it is a
  shipped application rather than an announcement of one.
*/
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: site.name,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: site.description,
      url: site.url,
      screenshot: productScreens.map((s) => `${site.url}${s.src}`),
      audience: {
        "@type": "Audience",
        audienceType: "Independent auto repair shops",
      },
      offers: {
        "@type": "Offer",
        availability: "https://schema.org/InStock",
        url: `${site.url}${site.signupPath}`,
      },
    },
    {
      "@type": "Organization",
      name: site.name,
      url: site.url,
      email: site.contactEmail,
      description: site.description,
      foundingDate: site.company.founded,
      address: {
        "@type": "PostalAddress",
        addressLocality: site.company.city,
        addressRegion: site.company.region,
        addressCountry: site.company.country,
      },
      contactPoint: {
        "@type": "ContactPoint",
        email: site.contactEmail,
        contactType: "sales",
      },
      founder: founders.map((person) => ({
        "@type": "Person",
        name: person.name,
        jobTitle: person.title,
        image: `${site.url}${person.image}`,
        sameAs: person.links.map((link) => link.href),
      })),
    },
  ],
};

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper"
      >
        Skip to content
      </a>

      <Nav />

      <main id="main" className="flex-1">
        <Hero />
        <BoardSection />
        <Stats />
        <HowItWorks />
        <OneRecord />
        <RunsItself />

        <section className="band-tight border-t border-line bg-paper-2">
          <div className="shell">
            <Reveal>
              <LostCalls />
            </Reveal>
          </div>
        </section>

        <WhySwitch />
        {/*
          The product itself sits where the pilot stories used to. Those
          stories were placeholders — fictional shops, labelled as such — and
          a page that shows a real app has no room for invented customers
          beside it. Real ones go back in when there are real ones to quote.
        */}
        <Product />
        <Founders />
        <Faq />
        <Cta />
      </main>

      <Footer />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
