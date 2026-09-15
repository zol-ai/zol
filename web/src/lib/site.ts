/**
 * Single source of truth for anything that appears in more than one place on
 * the marketing site. Change the demo link here and every button follows.
 */

export const site = {
  name: "ZOL",
  tagline: "The best AI shop management software",
  description:
    "ZOL is shop management software that does the work instead of just recording it: it answers every call night and weekend, writes the repair order, texts estimates and chases approvals, orders parts and flags vendor delays.",
  url: "https://tryzol.com",
  demoUrl: "https://calendar.app.google/Q262bp3TVLBRcedm9",
  contactEmail: "zaz@tryzol.com",
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

export const nav = [
  { label: "How it works", href: "#how-it-works" },
  { label: "One record", href: "#one-record" },
  { label: "What it does", href: "#runs-itself" },
  { label: "Why switch", href: "#why-switch" },
  { label: "Stories", href: "#stories" },
  { label: "Founders", href: "#founders" },
] as const;
