import "server-only";

/**
 * The address a request came from, for rate limits.
 *
 * `x-forwarded-for` is a comma-separated list that every hop may append to,
 * and the first entry is whatever the caller chose to send. The two places
 * this app runs both put the real client at the END: Vercel overwrites the
 * header with a single value, and Cloud Run's front end appends the
 * connecting address to anything the caller supplied. So the last entry is
 * the one to trust, and a limit keyed on the first would be a limit anyone
 * could dodge with one header.
 *
 * `x-real-ip` is deliberately not consulted: off Vercel it is caller-set.
 * No header at all is a shared "unknown" bucket rather than a free pass.
 */
export function clientIp(headers: Headers): string | null {
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries[entries.length - 1] : null;
}
