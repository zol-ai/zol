# ZOL — connecting the cloud

Three connections, in the order they unblock each other:

1. **GitHub** — already live. `origin` is `ezazahamad2003/zol`.
2. **GCP** — project `zol-ai` (number 146626211362), owned by
   `zaz@tryzol.com`. Cloud SQL for Postgres, plus Cloud Run later for the
   realtime call service.
3. **Vercel** — `web/` as the project root.

Everything below is scripted in `infra/`. The scripts are idempotent; re-run
one after a failure rather than unpicking it by hand.

---

## One-time logins

These are browser flows and have to be run by a human, not by an agent:

```bash
gcloud auth login zaz@tryzol.com
```

```bash
gcloud auth application-default login
```

```bash
vercel login
```

The second one matters and is easy to skip. `gcloud auth login` authorises the
`gcloud` CLI; `application-default login` writes the credentials that *client
libraries* read — which is what `web/scripts/load-schema.mjs` uses to reach
Cloud SQL from this machine.

---

## 1. Provision Cloud SQL

```bash
pwsh ./infra/gcp-setup.ps1
```

Creates, in order: the APIs, a Postgres 16 instance, the `zol` database, the
`zol` user with a generated password in Secret Manager, and a `zol-vercel`
service account holding exactly one role — `roles/cloudsql.client`. The project
already exists, so the script only touches what's inside it.

If `zol-ai` has no billing account linked yet, Cloud SQL will refuse to create.
Link one first:

```bash
gcloud billing accounts list
```

```bash
pwsh ./infra/gcp-setup.ps1 -BillingAccount XXXXXX-XXXXXX-XXXXXX
```

Instance creation takes 5–10 minutes. Defaults are `us-west1`, `db-f1-micro`,
zonal, 10 GB SSD, daily backups with point-in-time recovery.

**Cost.** A `db-f1-micro` zonal instance runs roughly $10–15/month with storage
and backups. It is a shared-core machine and will not carry production call
volume — plan on `db-custom-1-3840` or larger before the first shop goes live.
Changing tier is an in-place restart, not a migration.

**No authorized networks are configured, deliberately.** The instance requires
SSL and only accepts connections that present a certificate issued by the Cloud
SQL Admin API. There is no open IP to find.

## 2. Load the schema

```bash
pwsh ./infra/load-schema.ps1
```

Pulls the password from Secret Manager and runs `db/schema.sql` through
`web/scripts/load-schema.mjs`. The whole file goes in as one simple query, so
it runs in a single implicit transaction — a failure rolls back completely
instead of leaving half a schema behind.

`db/schema.sql` has never executed anywhere. Expect the first run to find
something; the loader prints the offending line number.

## 3. Point Vercel at it

```bash
cd web && vercel link
```

Project root is `web/`, framework preset Next.js. Then:

```bash
pwsh ./infra/vercel-env.ps1
```

Writes `INSTANCE_CONNECTION_NAME`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` and
`GCP_SERVICE_ACCOUNT_JSON` to the production and preview environments, minting
the service-account key if one isn't cached in `infra/.keys/` (gitignored).

Then deploy and check:

```bash
cd web && vercel --prod
```

```bash
curl https://<deployment>/api/health/db
```

A healthy response names the server, the database, and how many tables it
found. `publicTables: 0` means the connection works but step 2 didn't run.

---

## Why the Cloud SQL connector and not a connection string

Vercel functions get a fresh egress IP on more or less every invocation, so
`--authorized-networks` cannot be made to work — the choice would be between
`0.0.0.0/0` and a broken deployment. The Node connector sidesteps it: it asks
the Admin API for a short-lived client certificate and dials the instance
directly over mutual TLS. The database stays closed to everything that can't
authenticate to GCP first.

Cloud Run gets its identity from the metadata server and needs no key. Vercel
is outside GCP, so it carries a service-account key — which is why that account
holds one role and nothing else.

## The two health routes

| Route | What it does | Who calls it |
| --- | --- | --- |
| `/api/health` | Reports which subsystems have credentials. No I/O. | Cloud Run liveness probe, every 30s |
| `/api/health/db` | Opens a real connection and queries. | You, after wiring credentials |

They are separate on purpose. If the liveness probe touched the database, a
brief Cloud SQL blip would restart a container that was serving the landing
page perfectly well.

## Cloud Run (later)

The realtime call service is not built yet. When it is, the same commit
deploys:

```bash
gcloud run deploy zol-web --source web --region us-west1 --allow-unauthenticated
```

On Cloud Run, attach the instance and drop the key:

```bash
gcloud run services update zol-web --add-cloudsql-instances zol-ai:us-west1:zol-pg --region us-west1
```

Set `CLOUD_SQL_IP_TYPE=PRIVATE` only once a VPC connector exists; without one
the private path has no route and connections hang until the timeout.
