import { Pool } from "pg";
import { env } from "./env";

let pool: Pool | null = null;

/**
 * Lazily-created shared pool. Returns null when DATABASE_URL is unset so the
 * dashboard can render a setup notice instead of crashing.
 */
export function getPool(): Pool | null {
  const url = env.databaseUrl();
  if (!url) return null;
  if (!pool) {
    const local = url.includes("localhost") || url.includes("127.0.0.1");
    pool = new Pool({
      connectionString: url,
      max: 5,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export function requirePool(): Pool {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not set. See .env.example.");
  return p;
}
