import "server-only";

import { headers } from "next/headers";

import { env } from "./env";

/**
 * The origin a link should carry when it leaves the building.
 *
 * The host the person is actually looking at, not ZOL_PUBLIC_URL: that
 * variable exists to reconstruct the exact string Twilio signed and has
 * nothing to do with where a shop browses from. A portal link minted on a
 * preview deployment should point at that preview. Outside a request (the
 * follow-up worker has no browser on the other end) the configured
 * customer-facing origin is the only honest answer, so it is the fallback —
 * ZOL_CUSTOMER_URL when set, else ZOL_PUBLIC_URL, else the production site.
 */
export async function requestOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto =
        h.get("x-forwarded-proto") ??
        (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // Not inside a request. Fall through.
  }
  return (env.customerUrl ?? env.publicUrl ?? "https://tryzol.com").replace(/\/+$/, "");
}
