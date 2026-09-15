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
  /** Three sentences, in the site's voice. */
  bio: string;
  /** The résumé, one line each. */
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
    bio: "Ezaz came to ZOL from Berkeley Lab, where he did research on ESnet and co-authored two AI papers, and from a stint as CTO of a company he helped grow to $5M. He has built at Founders Inc and Zo World and won seven hackathons, most of them on voice and realtime systems — the part of ZOL that picks up the phone. He spent two months embedded in independent shops before this product had a name, and most of its opinions come from those weeks.",
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
        href: "https://www.linkedin.com/in/ezaz-ahamad-mohammad-abdul-821386229/",
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
    bio: "Amol holds a master's in AI and machine learning and did research on vision-language models before ZOL. He spent ten years shipping software at scale at Infosys and Tata Motors, and has won three startup challenges along the way. He built the first version of ZOL in a weekend at the Y Combinator × Google DeepMind × Cactus voice-agents hackathon; what shops run today is that same idea with the rough edges worn off by real phone calls.",
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
