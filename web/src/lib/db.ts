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
    // No TLS for localhost or for the Cloud Run Cloud SQL unix socket
    // (`?host=/cloudsql/<connection-name>`); the socket is already private.
    const plain =
      url.includes("localhost") || url.includes("127.0.0.1") || url.includes("host=/cloudsql/");
    pool = new Pool({
      connectionString: url,
      max: 5,
      ssl: plain ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export function requirePool(): Pool {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not set. See .env.example.");
  return p;
}
