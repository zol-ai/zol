/**
 * The waitlist's shape, shared by the form and the action.
 *
 * No `server-only` guard here on purpose: the option lists have to render in a
 * client component and be validated again on the server, and the whole point
 * is that there is one definition of what a valid answer is. The database
 * repeats the same two lists as CHECK constraints — three copies would be two
 * too many, but the third one is Postgres refusing to store a value the code
 * has never heard of, which is worth having.
 */

export const BAY_BANDS = ["1-3", "4-6", "7-10", "10+"] as const;
export type BayBand = (typeof BAY_BANDS)[number];

/**
 * Value is the stable key that goes in the column; label is what the page
 * says. They are separate because the wording will change and the rows have
 * to stay comparable.
 */
export const SHOP_SOFTWARE = [
  { value: "tekmetric", label: "Tekmetric" },
  { value: "shopmonkey", label: "Shopmonkey" },
  { value: "shop-ware", label: "Shop-Ware" },
  { value: "mitchell1", label: "Mitchell 1" },
  { value: "autoleap", label: "AutoLeap" },
  { value: "other", label: "Something else" },
  { value: "paper", label: "Paper & spreadsheets" },
] as const;

export type ShopSoftware = (typeof SHOP_SOFTWARE)[number]["value"];

export const SOFTWARE_LABEL: Record<ShopSoftware, string> = Object.fromEntries(
  SHOP_SOFTWARE.map((option) => [option.value, option.label]),
) as Record<ShopSoftware, string>;

export function isBayBand(value: string): value is BayBand {
  return (BAY_BANDS as readonly string[]).includes(value);
}

export function isShopSoftware(value: string): value is ShopSoftware {
  return SHOP_SOFTWARE.some((option) => option.value === value);
}

/** US ZIP. Five digits — ZIP+4 is more than we need and more to get wrong. */
export const ZIP = /^\d{5}$/;

/**
 * The name of the honeypot input.
 *
 * Named like something a form-filling bot wants to complete and a person never
 * sees. Kept here so the field and the check that reads it cannot drift apart.
 */
export const HONEYPOT = "company_website";

/** UTM keys captured off the landing URL, in the order they're stored. */
export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];

/** One waitlist row, as the database holds it. */
export interface WaitlistEntry {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  shop_name: string;
  zip: string;
  bays: BayBand;
  current_software: ShopSoftware;
  consent: boolean;
  consent_at: string;
  source_page: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
}
