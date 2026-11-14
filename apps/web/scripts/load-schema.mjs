/**
 * Load db/schema.sql into whichever Postgres the environment points at.
 *
 * Sends the whole file as one simple query. node-postgres runs a multi-
 * statement simple query inside one implicit transaction, so a failure
 * halfway through rolls the whole thing back rather than leaving a half-built
 * schema — which matters here because schema.sql has never run anywhere and
 * the first attempt is likely to find something.
 *
 *   cd web
 *   node scripts/load-schema.mjs
 *
 * Reads INSTANCE_CONNECTION_NAME + PGUSER/PGPASSWORD/PGDATABASE (Cloud SQL) or
 * DATABASE_URL (local / auth proxy). Cloud SQL also needs application-default
 * credentials: gcloud auth application-default login
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import {
  AuthTypes,
  Connector,
  IpAddressTypes,
} from "@google-cloud/cloud-sql-connector";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../../db/schema.sql");

const instance = process.env.INSTANCE_CONNECTION_NAME;
const url = process.env.DATABASE_URL;

if (!instance && !url) {
  console.error(
    "Set INSTANCE_CONNECTION_NAME (Cloud SQL) or DATABASE_URL (local).",
  );
  process.exit(1);
}

const sql = await readFile(schemaPath, "utf8");
console.log(`schema: ${schemaPath} (${sql.length} bytes)`);

let connector;
let client;

try {
  if (instance) {
    console.log(`connecting via Cloud SQL connector to ${instance}`);
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
  } else {
    console.log("connecting via DATABASE_URL");
    client = new pg.Client({ connectionString: url });
  }

  await client.connect();

  const { rows: before } = await client.query(
    "SELECT current_database() AS db, version() AS v",
  );
  console.log(`connected: ${before[0].db} — ${before[0].v.split(",")[0]}`);

  await client.query(sql);

  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );

  console.log(`\nschema loaded — ${tables.length} tables:`);
  for (const t of tables) console.log(`  ${t.table_name}`);
} catch (error) {
  // Postgres puts the byte offset of the syntax error in `position`, which is
  // the only thing that makes a 322-line file debuggable.
  console.error(`\nFAILED: ${error.message}`);
  if (error.position) {
    const offset = Number(error.position);
    const line = sql.slice(0, offset).split("\n").length;
    console.error(`  at schema.sql line ${line}`);
  }
  if (error.detail) console.error(`  detail: ${error.detail}`);
  if (error.hint) console.error(`  hint: ${error.hint}`);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
  connector?.close();
}
