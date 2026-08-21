import "server-only";

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/*
  Promisified by hand rather than with `promisify`: node:crypto declares scrypt
  with and without an options argument, and promisify's types resolve to the
  three-argument overload, so passing cost parameters stops type-checking.
*/
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/**
 * Password hashing, on scrypt from Node's standard library.
 *
 * bcrypt and argon2 are both native modules. On Vercel that means the build
 * has to produce a binary for the function runtime, and a mismatch surfaces as
 * a 500 on the sign-in route rather than as a build failure. scrypt is memory-
 * hard, in the platform, and needs nothing installed — the right trade for a
 * login form.
 *
 * Parameters follow the current OWASP minimum for scrypt (N=2^17, r=8, p=1),
 * which costs about 130ms and 128MB per hash on a Vercel function. That is
 * paid on sign-in and sign-up only.
 */
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

// Node's default maxmem is 32MB, and 128 * N * r is 128MB here, so scrypt
// refuses to run without this. Give it headroom rather than the exact figure.
const MAX_MEM = 256 * 1024 * 1024;

/** `scrypt$N$r$p$salt$hash`, all base64url. Self-describing so the cost can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });

  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Constant-time verify. Returns false rather than throwing on a malformed
 * stored value — a corrupt row must read as "wrong password", never as a
 * crash that tells an attacker the account exists.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, salt, expected] = parts;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isFinite(cost.N) || !Number.isFinite(cost.r) || !Number.isFinite(cost.p)) {
    return false;
  }

  const expectedKey = Buffer.from(expected, "base64url");
  if (expectedKey.length === 0) return false;

  try {
    const key = await scrypt(
      password.normalize("NFKC"),
      Buffer.from(salt, "base64url"),
      expectedKey.length,
      { ...cost, maxmem: MAX_MEM },
    );
    return timingSafeEqual(key, expectedKey);
  } catch {
    return false;
  }
}

/**
 * A dummy hash to verify against when the email doesn't exist.
 *
 * Without it, "no such account" answers in a millisecond and "wrong password"
 * answers in 130, which is a reliable oracle for whether an address has an
 * account here. Computed once per instance, lazily, so the cost lands on the
 * first miss instead of on every cold start.
 */
let decoy: Promise<string> | undefined;
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(24).toString("hex"));
  return decoy;
}
