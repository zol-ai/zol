import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Deep health check: actually opens a connection and asks Postgres who it is.
 *
 * Deliberately separate from `/api/health`. That one is the Cloud Run liveness
 * probe and runs every 30 seconds — it must not depend on the database, or a
 * brief Cloud SQL blip restarts a container that was serving the landing page
 * perfectly well. This route is the one to curl after wiring credentials.
 */
export async function GET() {
  const started = Date.now();

  try {
    const rows = await query<{
      version: string;
      database: string;
      user: string;
      tables: number;
    }>(
      `SELECT version()          AS version,
              current_database() AS database,
              current_user       AS user,
              (SELECT count(*)::int
                 FROM information_schema.tables
                WHERE table_schema = 'public') AS tables`,
    );

    const row = rows[0];

    return Response.json(
      {
        status: "ok",
        // "PostgreSQL 16.4 on x86_64..." — the first two words are the useful part.
        server: row.version.split(" ").slice(0, 2).join(" "),
        database: row.database,
        user: row.user,
        // 0 means connected but the schema was never loaded.
        publicTables: row.tables,
        via: process.env.INSTANCE_CONNECTION_NAME
          ? "cloud-sql-connector"
          : "direct",
        latencyMs: Date.now() - started,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // The message can carry a host or a user name, so it goes to the server
    // log; the response says only that it failed.
    console.error("[health/db]", error);

    return Response.json(
      {
        status: "error",
        reason:
          error instanceof Error ? error.constructor.name : "UnknownError",
        latencyMs: Date.now() - started,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
