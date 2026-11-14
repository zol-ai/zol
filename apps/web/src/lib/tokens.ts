import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque tokens and the one rule about them: the link carries the token, the
 * table holds only its SHA-256. Sessions, invites and portal links all use
 * this, so a dump of any of those tables replays as nothing.
 *
 * Split out of lib/auth.ts so the modules that only need a hash (portal
 * tokens, and everything that reaches them) don't pull in next/headers and
 * next/navigation, which the plain node test runner cannot load.
 */

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A fresh token and its hash. Show the token once; store the hash. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
