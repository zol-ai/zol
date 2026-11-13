/**
 * Dashboard login: one shared password (DASHBOARD_PASSWORD) exchanged for a
 * signed cookie. Uses Web Crypto only, so it runs in proxy.ts as well as in
 * server actions.
 */

export const SESSION_COOKIE = "zol_support_session";

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Buffer.from(sig).toString("base64url");
}

/** The cookie value that proves the holder knew the password. */
export async function sessionToken(password: string): Promise<string> {
  return hmac(password, "zol-support-dashboard-v1");
}

export async function isValidSession(password: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await sessionToken(password);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
