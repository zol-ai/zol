/**
 * The product, described once: what is in the app, and what it looks like.
 * The landing page's Product section, the About page and the structured
 * data all read from here, so the list of sections a reviewer sees is the
 * list the sidebar actually has.
 */

/** The app's sections, as the sidebar names them, with one line each. */
export const productSections = [
  {
    name: "Today",
    what: "The day at a glance: appointments, what's in the shop, what needs a person, revenue, technician load.",
  },
  {
    name: "Calls",
    what: "Every conversation ZOL has had — transcript, what it extracted, what it booked.",
  },
  {
    name: "Schedule",
    what: "A day per bay, with technicians. Arrive, check in, and the ticket opens itself.",
  },
  {
    name: "Repair orders",
    what: "The board, and the workbench: diagnostics, digital inspection, lines and approvals, estimate, parts, invoice, conversation, history.",
  },
  {
    name: "Inspections · Estimates · Parts · Invoices · Payments",
    what: "Shop-wide views of the same records.",
  },
  {
    name: "Technicians",
    what: "Each tech's queue, with one-tap status moves.",
  },
  {
    name: "Customers · Vehicles",
    what: "The connected record: visits, messages, calls, declined work, lifetime value.",
  },
  {
    name: "Messages",
    what: "Every thread with a customer, texts and portal messages alike.",
  },
  {
    name: "Follow-ups",
    what: "The CRM: declined work, inspection recommendations, post-repair check-ins, birthdays, win-backs — drafted by ZOL, sent by a person.",
  },
  {
    name: "Ask ZOL",
    what: "Questions about the shop, answered from its own data, with links to the record.",
  },
  {
    name: "Team · Settings",
    what: "People, pricing, hours, the quote cap, and which integrations are live.",
  },
  {
    name: "Customer portal",
    what: "The customer never signs in. Every estimate and invoice text carries a link to their car, its status, the inspection, the estimate to approve line by line, and the invoice to pay.",
  },
] as const;

/**
 * Screens from the app, as it runs today. Captured from a real ZOL instance
 * (the seeded demo shop) at desktop size — not drawn, not mocked up. The
 * landing page's board, ticket and call widgets are hand-built
 * demonstrations with sample data; these are the product itself, and the
 * page says so where it shows them.
 *
 * Recapture when a screen changes materially; a screenshot of a version that
 * no longer exists is a mockup with extra steps.
 */
export type ProductScreen = {
  src: string;
  alt: string;
  /** Where in the app this is, as the sidebar names it. */
  screen: string;
  /** One line on what the shop does here. */
  caption: string;
  width: number;
  height: number;
};

export const productScreens: ProductScreen[] = [
  {
    src: "/images/product/today.webp",
    alt: "The ZOL Today dashboard: appointments, cars in the shop, what needs a person, revenue and technician load",
    screen: "Today",
    caption:
      "The day at a glance — appointments, what's in the shop, what needs a person, revenue, technician load.",
    width: 1440,
    height: 900,
  },
  {
    src: "/images/product/schedule.webp",
    alt: "The ZOL schedule: a day laid out per bay with technicians and booked appointments",
    screen: "Schedule",
    caption:
      "A day per bay, with technicians. Arrive, check in, and the ticket opens itself.",
    width: 1440,
    height: 900,
  },
  {
    src: "/images/product/repair-order.webp",
    alt: "A ZOL repair order workbench: diagnostics, inspection, lines and approvals, estimate, parts, invoice and history on one ticket",
    screen: "Repair orders",
    caption:
      "The workbench: diagnostics, digital inspection, lines and approvals, estimate, parts, invoice, history — one ticket.",
    width: 1440,
    height: 900,
  },
  {
    src: "/images/product/customer.webp",
    alt: "A ZOL customer record: contact details, vehicles, visits, lifetime value and service history on one page",
    screen: "Customers",
    caption:
      "The connected record: vehicles, visits, messages, declined work, lifetime value — and a ticket or a text one click away.",
    width: 1440,
    height: 900,
  },
  {
    src: "/images/product/follow-ups.webp",
    alt: "The ZOL follow-ups CRM: declined work, inspection recommendations and post-repair check-ins drafted by ZOL",
    screen: "Follow-ups",
    caption:
      "The CRM: declined work, inspection recommendations, post-repair check-ins — drafted by ZOL, sent by a person.",
    width: 1440,
    height: 900,
  },
  {
    src: "/images/product/portal.webp",
    alt: "The ZOL customer portal on a phone: the vehicle, its status, the inspection and an estimate to approve line by line",
    screen: "Customer portal",
    caption:
      "What the customer gets by text: their car, the inspection, the estimate to approve line by line, the invoice to pay. No app, no sign-in.",
    width: 900,
    height: 1400,
  },
];
