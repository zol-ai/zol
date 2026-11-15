/**
 * The shop's public handle: tryzol.com/talk/<slug> is where a customer
 * reaches its receptionist from the web.
 *
 * Lowercase letters, digits and single dashes, matching the CHECK in
 * 0007. Derived from the name; a collision gets a short random suffix rather
 * than a number, because "main-street-auto-2" tells the second shop it was
 * second.
 */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    // Strip the combining marks NFKD split off: "Peña" → "Pena".
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return base.length >= 2 ? base : `shop-${randomSuffix()}`;
}

export function randomSuffix(length = 4): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
