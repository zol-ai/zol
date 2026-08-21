/**
 * Phone numbers.
 *
 * The schema stores E.164 and enforces it with a CHECK, because the number is
 * the customer's identity here — it's the one thing we have when the phone
 * rings, and it has to match whatever Twilio hands us in `From`. What a person
 * types at the counter is "555-0148" or "(415) 555 0148 ext 2", so the
 * conversion happens at the edge, once, on the way in.
 *
 * Default region is US. A shop in Vancouver types ten digits too and gets +1,
 * which is correct; anything genuinely international has to be typed with its
 * + and country code, and that is the honest limit of not carrying
 * libphonenumber for a 200KB table of numbering plans.
 */

/** Digits as typed → +1XXXXXXXXXX, or undefined if it can't be one. */
export function toE164(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  // An explicit + means the person knows what they're doing: keep the country
  // code they gave and only strip the formatting.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
      return undefined;
    }
    return `+${digits}`;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

/** +14155550148 → (415) 555-0148. Anything else is returned untouched. */
export function formatPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}
