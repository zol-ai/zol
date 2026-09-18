/**
 * Single source of truth for anything that appears in more than one place on
 * the marketing site. Change the demo link here and every button follows.
 */

export const site = {
  name: "ZOL",
  tagline: "The best AI shop management software",
  description:
    "ZOL is shop management software that does the work instead of just recording it: it answers every call night and weekend, writes the repair order, texts estimates and chases approvals, orders parts and flags vendor delays.",
  /*
    The host the site is actually served from. Vercel holds both names and
    308s the bare apex to www, so this is what a crawler, a link preview or a
    reviewer ends up on — canonical, sitemap, Open Graph and the JSON-LD all
    say the same thing. If the primary domain ever flips to the apex in
    Vercel, flip it here in the same change.
  */
  url: "https://www.tryzol.com",
  demoUrl: "https://calendar.app.google/Q262bp3TVLBRcedm9",
  contactEmail: "zaz@tryzol.com",
  /*
    The company, stated once. These are the facts on the incorporation
    paperwork and on every application form we fill in; the About page and
    the structured data read them from here so no two places disagree.
  */
  company: {
    founded: "2025",
    city: "San Francisco",
    region: "California",
    country: "US",
  },
  aboutPath: "/about",
  signupPath: "/signup",
  signinPath: "/signin",
  /*
    The waitlist route still exists — flyers and ads point at it, and the
    sweep to Company OS runs off its table — but as of 2026-09-15 nothing on
    the site links to it. A public "join waitlist" button reads as
    pre-launch, and the product is live; a reviewer took the button at face
    value and declined us for it. So: reachable by URL, out of the sitemap,
    noindex, and no button in the nav or footer. Put a link back only if
    that decision is reversed on purpose.
  */
  waitlistPath: "/waitlist",
} as const;

/*
  Header and footer links. Section links are rooted at "/" so they work from
  any page — from /about, "How it works" goes home and scrolls, instead of
  looking for a fragment that isn't there.
*/
export const nav = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "What it does", href: "/#runs-itself" },
  { label: "Why switch", href: "/#why-switch" },
  { label: "Product", href: "/#product" },
  { label: "Founders", href: "/#founders" },
  { label: "About", href: site.aboutPath },
] as const;
