import { BoardSection } from "@/components/site/board-section";
import { Cta } from "@/components/site/cta";
import { Faq } from "@/components/site/faq";
import { Footer } from "@/components/site/footer";
import { Hero } from "@/components/site/hero";
import { HowItWorks } from "@/components/site/how-it-works";
import { LostCalls } from "@/components/site/lost-calls";
import { Nav } from "@/components/site/nav";
import { OneRecord } from "@/components/site/one-record";
import { Reveal } from "@/components/site/reveal";
import { RunsItself } from "@/components/site/runs-itself";
import { Stats } from "@/components/site/stats";
import { WhySwitch } from "@/components/site/why-switch";
import { site } from "@/lib/site";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: site.name,
  applicationCategory: "BusinessApplication",
  description: site.description,
  url: site.url,
  audience: {
    "@type": "Audience",
    audienceType: "Independent auto repair shops",
  },
  offers: {
    "@type": "Offer",
    availability: "https://schema.org/PreOrder",
    url: site.demoUrl,
  },
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
