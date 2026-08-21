import "server-only";

import { Pool, type PoolConfig, type QueryResultRow } from "pg";
import {
  AuthTypes,
  Connector,
  IpAddressTypes,
} from "@google-cloud/cloud-sql-connector";
import { GoogleAuth } from "google-auth-library";

/**
 * The one Postgres pool.
 *
 * Two ways in, because the two deploy targets can't reach the database the
 * same way:
 *
 *   * `INSTANCE_CONNECTION_NAME` set — the Cloud SQL Node connector. It
 *     fetches short-lived client certificates over the Admin API and dials the
 *     instance directly, so nothing has to be exposed to an IP allowlist.
 *     Vercel's functions get a fresh egress IP on more or less every
 *     invocation, which makes `authorized networks` unusable there; this is
 *     the way that works from both Vercel and Cloud Run.
 *
 *   * Otherwise `DATABASE_URL` — plain TCP. Local Postgres, or the Cloud SQL
 *     Auth Proxy on localhost during development.
 *
 * Either way the credentials come from the environment and the password never
 * appears in code.
 */

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/**
 * Serverless invocations are short and concurrent — a large per-instance pool
 * multiplied by however many instances Vercel spins up exhausts Cloud SQL's
 * connection limit long before it helps throughput.
 */
const BASE: PoolConfig = {
  max: Number(optional("DATABASE_POOL_MAX") ?? 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
};

/**
 * How the connector proves who we are to the Cloud SQL Admin API.
 *
 * On Cloud Run this is the attached service account and there is nothing to
 * configure — the metadata server answers. Vercel has no metadata server, so
 * it carries the service-account key as JSON in an environment variable.
 * `GOOGLE_APPLICATION_CREDENTIALS` is not an option there: the library treats
 * it as a *path*, and there is no writable file to point it at.
 */
function googleAuth(): GoogleAuth {
  const raw = optional("GCP_SERVICE_ACCOUNT_JSON");
  if (!raw) return new GoogleAuth();

  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error(
      "GCP_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole key file, " +
        "including the outer braces.",
    );
  }

  return new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/sqlservice.admin"],
  });
}

async function createPool(): Promise<Pool> {
  const instance = optional("INSTANCE_CONNECTION_NAME");

  if (instance) {
    const connector = new Connector({ auth: googleAuth() });
    const options = await connector.getOptions({
      instanceConnectionName: instance,
      // Cloud Run with a VPC connector should set this to PRIVATE; Vercel has
      // no path to the VPC and has to go out over the public endpoint, which
      // is still fully encrypted and certificate-authenticated by the
      // connector — the instance never accepts an unauthenticated dial.
      ipType:
        optional("CLOUD_SQL_IP_TYPE") === "PRIVATE"
          ? IpAddressTypes.PRIVATE
          : IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
    });

    return new Pool({
      ...BASE,
      ...options,
      user: optional("PGUSER") ?? "zol",
      password: optional("PGPASSWORD"),
      database: optional("PGDATABASE") ?? "zol",
    });
  }

  const url = optional("DATABASE_URL");
  if (!url) {
    throw new Error(
      "No database configured. Set INSTANCE_CONNECTION_NAME (Cloud SQL) or " +
        "DATABASE_URL (local/proxy). See .env.example.",
    );
  }

  return new Pool({ ...BASE, connectionString: url });
}

/**
 * Memoised on the promise, not the pool, so two requests arriving during the
 * connector's first handshake share one pool instead of opening two.
 */
let pending: Promise<Pool> | undefined;

export function db(): Promise<Pool> {
  pending ??= createPool().catch((error) => {
    // Don't cache a failed handshake — the next request should retry.
    pending = undefined;
    throw error;
  });
  return pending;
}

/** Parameterised query. Never interpolate values into the SQL string. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<T[]> {
  const pool = await db();
  const result = await pool.query<T>(text, params as unknown[] | undefined);
  return result.rows;
}

/** True if the database answers. Used by the deep health check. */
export async function ping(): Promise<boolean> {
  const rows = await query<{ ok: number }>("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
