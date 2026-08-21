/**
 * Single source of truth for anything that appears in more than one place on
 * the marketing site. Change the demo link here and every button follows.
 */

export const site = {
  name: "ZOL",
  tagline: "The best AI shop management tool",
  description:
    "ZOL is shop management software that does the work instead of just recording it: it answers every call night and weekend, writes the repair order, texts estimates and chases approvals, orders parts and flags vendor delays.",
  url: "https://tryzol.com",
  demoUrl: "https://calendar.app.google/Q262bp3TVLBRcedm9",
  contactEmail: "hello@tryzol.com",
} as const;

export const nav = [
  { label: "How it works", href: "#how-it-works" },
  { label: "One record", href: "#one-record" },
  { label: "What it does", href: "#runs-itself" },
  { label: "Why switch", href: "#why-switch" },
] as const;
