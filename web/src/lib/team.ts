/**
 * The founders, as they appear on the landing page.
 *
 * Everything in this file is real and checkable: the photographs are of the
 * people named, the facts are the ones on the pitch deck, and every link goes
 * to a public profile on a third-party site — so a visitor (or a compliance
 * reviewer) can verify who is behind ZOL without taking the page's word for
 * it. Keep it that way. No placeholder people, no dead links; if a profile
 * moves, change it here or drop it.
 */

export type FounderLink = {
  /** The site, spoken as its name: LinkedIn, GitHub, X. */
  label: string;
  href: string;
};

export type Founder = {
  name: string;
  /** As shown on the page. */
  role: string;
  /** As sent to search engines (schema.org `jobTitle`). */
  title: string;
  image: string;
  imageAlt: string;
  /** The résumé, one line each. No prose — the list is the bio. */
  facts: string[];
  links: FounderLink[];
};

export const founders: Founder[] = [
  {
    name: "Ezaz Ahamad",
    role: "Co-founder · CEO",
    title: "Co-founder and Chief Executive Officer",
    image: "/images/team/ezaz-ahamad.jpg",
    imageAlt:
      "Ezaz Ahamad on the shore below the Golden Gate Bridge at dusk, looking over his shoulder at the camera",
    facts: [
      "ex-Berkeley Lab researcher",
      "2× AI research publications",
      "Former CTO of a $5M company",
      "Founders Inc · Zo World",
      "7× hackathon wins",
    ],
    links: [
      {
        label: "LinkedIn",
        href: "https://www.linkedin.com/in/ezaz-ahamad-821386229/",
      },
      { label: "GitHub", href: "https://github.com/ezazahamad2003" },
      { label: "X", href: "https://x.com/Zaz_Labs" },
    ],
  },
  {
    name: "Amol S Bhalerao",
    role: "Co-founder · CTO",
    title: "Co-founder and Chief Technology Officer",
    image: "/images/team/amol-bhalerao.jpg",
    imageAlt:
      "Amol S Bhalerao on a San Francisco street, smiling at the camera with a name tag on his shirt",
    facts: [
      "Master's in AI / Machine Learning",
      "VLM researcher",
      "ex-Infosys · ex-Tata Motors",
      "3× Startup Challenge winner",
      "10+ years shipping at scale",
    ],
    links: [
      {
        label: "LinkedIn",
        href: "https://www.linkedin.com/in/amol-s-bhalerao/",
      },
    ],
  },
];
