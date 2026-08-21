/**
 * Apply everything in db/migrations that this database hasn't seen.
 *
 *   cd web
 *   node scripts/migrate.mjs           # apply
 *   node scripts/migrate.mjs --status  # list, change nothing
 *
 * Same connection rules as load-schema.mjs: INSTANCE_CONNECTION_NAME with
 * PGUSER/PGPASSWORD/PGDATABASE for Cloud SQL (plus `gcloud auth
 * application-default login`), or DATABASE_URL for local Postgres.
 *
 * This is run by a human from a laptop, not by the build. A Vercel build has
 * no reliable route to Cloud SQL, and a migration that runs from CI would race
 * every preview deployment against production's schema.
 *
 * db/schema.sql is the baseline, not a migration. A database that already has
 * the baseline tables gets '0000_baseline' recorded for it rather than
 * re-running anything, so this is safe against the instance that was loaded
 * before migrations existed.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import {
  AuthTypes,
  Connector,
  IpAddressTypes,
} from "@google-cloud/cloud-sql-connector";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "../../db/migrations");
const statusOnly = process.argv.includes("--status");

const instance = process.env.INSTANCE_CONNECTION_NAME;
const url = process.env.DATABASE_URL;

if (!instance && !url) {
  console.error(
    "Set INSTANCE_CONNECTION_NAME (Cloud SQL) or DATABASE_URL (local).",
  );
  process.exit(1);
}

let connector;
let client;

try {
  if (instance) {
    connector = new Connector();
    const options = await connector.getOptions({
      instanceConnectionName: instance,
      ipType:
        process.env.CLOUD_SQL_IP_TYPE === "PRIVATE"
          ? IpAddressTypes.PRIVATE
          : IpAddressTypes.PUBLIC,
      authType: AuthTypes.PASSWORD,
    });
    client = new pg.Client({
      ...options,
      user: process.env.PGUSER ?? "zol",
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE ?? "zol",
    });
    console.log(`connecting to ${instance}`);
  } else {
    client = new pg.Client({ connectionString: url });
    console.log("connecting via DATABASE_URL");
  }

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      ms         integer
    )
  `);

  // Adopt an instance that was built from schema.sql before this runner
  // existed: the tables are there, so the baseline is applied by definition.
  const { rows: baseline } = await client.query(
    `SELECT to_regclass('public.shops') IS NOT NULL AS has_baseline,
            EXISTS (SELECT 1 FROM schema_migrations
                     WHERE version = '0000_baseline') AS recorded`,
  );
  if (baseline[0].has_baseline && !baseline[0].recorded) {
    await client.query(
      "INSERT INTO schema_migrations (version, ms) VALUES ('0000_baseline', 0)",
    );
    console.log("  0000_baseline  adopted (tables already present)");
  }

  const { rows: done } = await client.query(
    "SELECT version FROM schema_migrations",
  );
  const applied = new Set(done.map((r) => r.version));

  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, "")));

  if (statusOnly) {
    for (const f of files) {
      const v = f.replace(/\.sql$/, "");
      console.log(`  ${applied.has(v) ? "applied" : "PENDING"}  ${v}`);
    }
    process.exit(0);
  }

  if (pending.length === 0) {
    console.log("up to date");
    process.exit(0);
  }

  for (const file of pending) {
    const version = file.replace(/\.sql$/, "");
    const sql = await readFile(join(dir, file), "utf8");
    const started = Date.now();

    // One transaction per migration: a failure leaves the database on the
    // last good version rather than half-way through this one. Postgres does
    // DDL transactionally, which is the whole reason this is possible.
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version, ms) VALUES ($1, $2)",
        [version, Date.now() - started],
      );
      await client.query("COMMIT");
      console.log(`  applied  ${version}  (${Date.now() - started}ms)`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      error.zolVersion = version;
      error.zolSql = sql;
      throw error;
    }
  }

  console.log(`\n${pending.length} migration(s) applied`);
} catch (error) {
  console.error(`\nFAILED${error.zolVersion ? `: ${error.zolVersion}` : ""}`);
  console.error(`  ${error.message}`);
  if (error.position && error.zolSql) {
    const line = error.zolSql.slice(0, Number(error.position)).split("\n").length;
    console.error(`  at line ${line}`);
  }
  if (error.detail) console.error(`  detail: ${error.detail}`);
  if (error.hint) console.error(`  hint: ${error.hint}`);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
  connector?.close();
}
