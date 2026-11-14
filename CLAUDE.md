# ZOL monorepo

Three apps in one repository, each still built and deployed on its own:

```
apps/
├── web/       tryzol.com — marketing site, waitlist, Shop OS   (Next.js + Postgres)
├── brain/     Company OS — internal dashboard                  (Next.js + Firestore)
└── support/   Phone support agent — Twilio ↔ OpenAI Realtime   (Next.js + Postgres)
```

Until November 2026 these were three independent repos (`zol-ai/zol`,
`zol-ai/company-brain`, `zol-ai/zol-customer-support`); they were merged with
`git subtree`, so their full histories are in this repo's log.

## Repository rules

- **One repo, separate deploys.** A change that spans apps can land in one
  commit now, but the apps still **ship independently** — nothing may assume
  two sides of an integration deploy together. Assume one side is live before
  the other, in either order.
- **Each app directory is its own deployable root.** `package.json`,
  `Dockerfile`, `.env.example`, `SETUP.md`/`README.md` live in the app, and
  every container build context is the app directory alone — the repo root is
  never inside an image.
- **Lockfiles are per app, plus one at the root.** The root lockfile serves
  `npm install` at the root and CI; each app's own `package-lock.json` is what
  its Docker/Cloud Run build uses. After a dependency change, refresh both
  (root `npm install`, then `npm install --workspaces=false` in the app).
- CI workflows are path-filtered per app and never deploy. Deploys are manual
  `gcloud` commands documented per app.

## Naming

The directory is `apps/brain`. The product is **Company OS**. **Company
Brain** is the OpenAI-powered agent *inside* Company OS. In new code and
docs, say "Company OS" for the app and "Company Brain" only for the agent.

## Data flows one way: tryzol.com → Company OS

**Company OS never exposes data to tryzol.com.** No endpoint in `apps/web`
may consume Company OS data, no Company OS credential may live in the web
app's environment, and no `apps/web` code may read Firestore — in any
direction of initiation. The read endpoint on the web side
(`GET /api/waitlist/entries`) conforms: it is the web app's *own* data being
read *by* Company OS. The direction that matters is where the data
originates, not who opens the connection.

This is a standing decision (2026-08-28), not a law of physics — it may
change later. Until it explicitly does, any feature that would surface CRM
records, tasks, or anything else from Company OS on tryzol.com is out of
bounds, and the right response to a request that seems to need it is to say
so, not to build it. Sharing a repo changes none of this: the boundary is
between the running services, not the folders.

---

# The integration: waitlist submissions → Company OS

A visitor submits the waitlist form on tryzol.com. The site writes to its own
Postgres and returns success — **and stops there**. Delivery to Company OS is
a separate, scheduled sweep.

```
visitor
   │
   ▼
tryzol.com (apps/web)
   │  1. UPSERT into Postgres waitlist_entries on lower(email)
   │     new row      → event_id generated, revision 0, delivered_at null
   │     payload changed → revision++, delivered_at reset to null
   │     nothing changed → row untouched, no redelivery
   │  2. return 200 to the visitor          ← request ends here. No outbound call.
   ▼
Postgres  ← the durable queue

        ┌─────────────────────────────────────────┐
        │ Cloud Scheduler, every 5 minutes        │
        └────────────────┬────────────────────────┘
                         ▼
   sweeper endpoint (apps/web, Cloud Run deployment only)
   │  3. SELECT rows with delivered_at IS NULL, last 7 days
   │  4. POST /api/events per row
   │     Authorization: Bearer <OIDC token from metadata server>
   │  5. stamp delivered_at on success
   ▼
Company OS (apps/brain, Cloud Run)
   │  6. verify token: Google issuer, audience, allowed SA email
   │  7. one transaction:
   │       ingest_events/{event_id}:{revision} exists? → return 200, done
   │       else match clients by phone
   │         no match → create, status:'lead', source:'waitlist'
   │         match    → fill nulls, append contacts, conflicts → pending_review
   │       write ingest_events/{event_id}:{revision} marker
   ▼
Firestore
```

## Delivery model: sweep, not push

**The submission path makes no outbound HTTP call at all.** No
fire-and-forget, no best-effort POST inside the Server Action, nothing to
swallow or log. The visitor's request touches Postgres and returns.

**Postgres is the queue.** `waitlist_entries` carries the delivery state:

- `event_id` — uuid, generated once when the row is first inserted. Stable
  for the row's entire life. Identifies **the row**.
- `revision` — `int not null default 0`, incremented when the row's payload
  materially changes. Identifies **the version of the row**.
- `delivered_at` — `timestamptz`, null until Company OS has accepted that
  revision.

**Cloud Scheduler invokes the sweeper every 5 minutes.** The sweeper selects
rows where `delivered_at IS NULL` **and the row is from the last 7 days**,
POSTs each to Company OS, and stamps `delivered_at` on a 2xx.

The 7-day window is a **safety net, not a decision**. It exists so a
permanently failing row cannot be retried forever; it must never be the
mechanism by which rows are deliberately excluded from delivery. Anything
intentionally out of scope gets an explicit `delivered_at` value, so that a
row skipped on purpose and a row skipped by accident never look the same.

Consequences worth holding onto:

- **Retries are the normal case, not an edge case.** Every 5 minutes until
  delivered. The idempotency design below is load-bearing, not defensive.
- **Delivery is delayed by up to 5 minutes.** Accepted. Nothing in the
  product needs a lead in Company OS in real time.
- **A Company OS outage costs nothing.** Rows accumulate and drain when it
  returns.
- **The sweeper is the only sender.** No other code path POSTs to
  `/api/events`.

## Row identity vs. delivery identity

**Two different keys; never collapse them into one.**

`waitlist_entries` deduplicates on `lower(email)` — the Server Action
upserts, so a person who submits twice **updates one row**. That makes the
row *mutable*, which means a single stable ID cannot also serve as the
deduplication key: a corrected phone number arriving under an `event_id`
Company OS had already seen would be treated as a duplicate and silently
dropped. Corrections would never land, and nothing would look broken.

| Key | Value | Identifies | Used for |
| --- | --- | --- | --- |
| `event_id` | uuid, fixed at insert | the person / the row | lineage — `source_event_id` on contacts |
| `revision` | int, starts 0 | the version of that row | — |
| `event_id:revision` | composite string | one delivery | the `ingest_events` marker ID |

**The `ingest_events` marker is keyed by `${event_id}:${revision}`, never by
the bare `event_id`.** A pure retry of an unchanged row reuses the same
composite and collapses. A corrected submission carries a new `revision`, so
it is a new marker against the *same* client document, and the correction is
applied.

### When `revision` bumps

**Only when a field that appears in the event payload actually changed.** A
resubmission with identical values must not bump, must not reset
`delivered_at`, and must not redeliver. Derive the comparison set from the
payload schema rather than hand-maintaining a second list. Columns that are
*not* in the payload — `ip`, `user_agent`, `updated_at`, rate-limit
bookkeeping — must never bump it.

When `revision` bumps, the same statement sets `delivered_at = null`. The two
go together; a bump without a reset is a correction that never ships.

## Event envelope

```jsonc
{
  "event_id":    "uuid",                       // stable per row, from Postgres
  "revision":    0,                            // int, from Postgres
  "type":        "waitlist.submitted",
  "occurred_at": "2026-08-27T18:04:11.221Z",   // ISO 8601, UTC — submission time,
                                               //   not delivery-attempt time
  "source":      "tryzol.com",
  "payload":     { /* type-specific */ }
}
```

- **Both `event_id` and `revision` are sent as separate fields.** Company OS
  needs the bare `event_id` for lineage and the composite for the marker.
- `occurred_at` is when the visitor submitted, read from the row. It does not
  move when the sweeper retries. On a revision bump it becomes the time of
  the resubmission that caused the bump.
- `type` is namespaced `<domain>.<past-tense-verb>`. Company OS switches on
  it and **rejects unknown types** rather than storing them generically.
- `payload` is validated per `type` with a Zod schema, matching the existing
  convention in `apps/brain/lib/validation/schemas.ts`.

## Auth: Google OIDC, one path only

**Sender (the sweeper):** mint a Google-signed OIDC **ID token** from the
Cloud Run metadata server, `audience` = the Company OS `run.app` base URL.
Send it as `Authorization: Bearer <token>`. `google-auth-library` is already
a dependency in `apps/web` (used by `apps/web/src/lib/db.ts` for Cloud SQL
auth) — reuse it.

**This is the only credential path.** No Workload Identity Federation for
this integration, no Vercel path, no fallback. `apps/web` does build for both
Vercel and Cloud Run, and the site's *database* access on Vercel goes through
WIF (`@vercel/oidc` + `ExternalAccountClient` in `apps/web/src/lib/db.ts`) —
but that is the DB path and is unrelated. **The sweeper endpoint runs on the
Cloud Run deployment only.** If the sweeper somehow runs where no metadata
server answers, it should fail loudly rather than silently degrade.

**Receiver (Company OS):** verify the token before doing anything else. All of:

1. Signature valid against Google's public keys.
2. `iss` is Google.
3. `aud` **exactly equals** the configured Company OS URL.
4. `email` is in an explicit allowlist of service account emails, and
   `email_verified` is true.

Reject with 401 and no detail on any failure. This route is the **only**
unauthenticated-by-session route in Company OS — every other route goes
through `authorized()` in `apps/brain/lib/api-server.ts`, and this one
deliberately does not.

The allowed sender identity is configuration, not code — an env var separate
from `ALLOWED_EMAILS`. One gates humans, one gates machines; conflating them
would let a human session reach the event route or a service account reach
the workspace.

**The sweeper endpoint has its own auth** — it is a public URL on the zol
Cloud Run service and must only answer Cloud Scheduler, which presents an
OIDC token checked against `COMPANY_OS_SCHEDULER_SERVICE_ACCOUNT` and
`COMPANY_OS_SWEEP_AUDIENCE`. It must never be reachable unauthenticated.

## Ingest: one transaction

`event_id` is **not** a Firestore document ID for the client record.
Deduplication lives in **`ingest_events/{event_id}:{revision}`**, a marker
document and nothing the app reads for business logic.

The ingest route runs **one Firestore transaction**:

1. Read `ingest_events/{event_id}:{revision}`. **If it exists, return 200
   immediately.**
2. Otherwise, query `clients` where `phone == <e164 from payload>`.
3. **No match** → create a client: `status: 'lead'`, `source: 'waitlist'`,
   the payload's `phone`/`name`/`email`, a one-entry `contacts` array, and
   `last_inbound_at`.
4. **Match** → merge by the rules below. Never a blind overwrite.
5. Write the `ingest_events/{event_id}:{revision}` marker.

The marker and the client mutation commit together or not at all. A crash
between them cannot leave an event marked delivered but unapplied — the
sweeper retries the whole thing 5 minutes later.

Deterministic document IDs are new to Company OS's *request path* — every
existing `create*` in `apps/brain/lib/firestore/` uses an auto-generated
`.doc()` ID; do not copy those for the marker write. The idempotent-by-ID
shape has prior art in `apps/brain/scripts/seed.mjs`. Follow that.

### Merge rules — an inbound event never clobbers a human edit

A human curating a client record always wins over form input, and
disagreements are surfaced rather than resolved silently.

**Fill nulls.** A field that is null on the stored document takes the
payload's value. This is the only case where an inbound event writes a
top-level field.

**Conflicts go to `pending_review`, not over the top of the stored value.**
If the payload's value differs from a non-null stored value, the stored value
stays and the incoming one is recorded in a `pending_review` map keyed by
field name:

```jsonc
"pending_review": {
  "bays": { "incoming": "4-6", "source_event_id": "…", "at": "2026-08-27T…" }
}
```

The UI surfaces these and a human resolves each one: accept (write the field,
delete the key) or dismiss (delete the key). A later event for the same field
overwrites the pending entry; only the most recent disagreement is shown.

**Always update `last_inbound_at`.** Unconditional, every accepted event.

**Append to `contacts`.** `clients` carries a `contacts` array of
`{name, email, source_event_id}`. An event appends **if that email is not
already present** — matching on email keeps redeliveries and revisions from
growing the array. Two people at the same shop is real and common; the array
is where additional people accumulate, while top-level `name`/`email` stay
whatever landed first (fill-nulls/`pending_review` rules apply).
`source_event_id` is the **bare `event_id`**, not the composite.

## Firestore ownership

**Company OS is the only writer to Firestore.** tryzol.com never touches
Firestore directly — no Admin SDK, no client SDK, no service account with
datastore permissions. It speaks HTTP to Company OS and nothing else. Being
in one repo does not change this: `apps/web` must never import Firebase.

## Leads live in `clients` — there is no `leads` collection

Inbound waitlist submissions become documents in the **existing `clients`
collection** with `status: 'lead'` (the status enum in
`apps/brain/lib/validation/schemas.ts` already has that value). **Do not
create a `leads` collection** — rejected by decision: a second collection
would mean duplicating the client shape and a copy-based promotion that
leaves authority permanently ambiguous.

`clients` carries **`source: 'manual' | 'waitlist'`** — records a human
curated vs. records that arrived over the wire. `source` is **immutable after
creation**.

### Multiple CRMs

A CRM is a named pipeline: a document in the `crms` collection, with client
records carrying a `crmId`. The default pipeline has the **fixed document ID
`clients`**, is created automatically, and cannot be deleted. It is the only
pipeline waitlist ingest touches; the phone-match queries are scoped to it
with an equality filter. `crmId` is backfilled on every record rather than
defaulted at read time — a Firestore equality filter does not match documents
missing the field.

### The `/clients` view

Waitlist leads **appear in the CRM directly** — no unreviewed filter, no
toggle (decision 2026-08-28). The `waitlist` badge on the row carries the
came-over-the-wire context. A non-empty `pending_review` renders as a banner
above the table.

### Promotion is a status change

**No promote-by-copy.** Promotion sets `status` from `'lead'` to `'active'`
on the same document. A promoted waitlist lead stays `source: 'waitlist'`
forever.

## Phone numbers

**E.164 everywhere** — `+15551234567`. Phone is the **match key** for ingest,
so a formatting inconsistency is a duplicate client, not a cosmetic bug.

- `apps/web` normalizes at the form boundary: `src/lib/phone.ts` (`toE164()`)
  plus the CHECK constraint in `apps/web/db/migrations/0003_waitlist.sql`.
- Company OS validates `phone` as E.164 in Zod on the way in. The sender
  sends valid data; the receiver rejects what isn't.
- Existing client records have `phone` null and are not backfilled; a null
  phone never matches anything, which is correct.
- A phone correction changes the match key; the payload carries the previous
  value (`phone_history`) so ingest can match on it.
- Formatting for humans happens at render time only (`formatPhone()` in
  `apps/web`).

## Backfill: pre-integration rows are already delivered

Migration 0005 set every then-existing `waitlist_entries` row to
`delivered_at = now()`, `revision = 0`, with a freshly generated `event_id` —
marked delivered because they are **out of scope**, not because they are old.
Historical entries reaching Company OS would be a separate one-off script,
run deliberately and watched.

---

# Where the integration code lives

## apps/web (sender)

- `db/migrations/0005_waitlist_delivery.sql` — `event_id`, `revision`,
  `delivered_at` plus the sweeper's partial index. Migrations run from a
  laptop (`npm run db:migrate:web` at the root), never from CI.
- `src/app/actions/waitlist.ts` — the `joinWaitlist` Server Action: the
  `ON CONFLICT (lower(email))` upsert whose `DO UPDATE` bumps `revision` and
  nulls `delivered_at` only when a payload field actually changed. No
  outbound call.
- `src/lib/company-brain.ts` — builds and sends the event envelope; called by
  the sweeper only.
- `src/app/api/waitlist/sweep` — the sweeper endpoint, Cloud Run only,
  authenticated against Cloud Scheduler.
- `src/app/api/waitlist/entries` — the read-only reconciliation window.
- `src/lib/env.ts` — server-only config; new vars get documented in
  `apps/web/.env.example`.

No ORM (raw `pg` via `src/lib/db.ts`), no generic fetch wrapper or retry
library — retry is the scheduler's job.

## apps/brain (receiver)

- `app/api/events/route.ts` — does **not** use `authorized()`.
- `app/api/reconcile/` — pages the waitlist read endpoint and replays through
  its own `/api/events`.
- `lib/validation/` — envelope + per-`type` payload schemas; `clients` schema
  carries `phone`, `source`, `contacts`, `last_inbound_at`, `pending_review`.
- `lib/firestore/clients.ts` — the transactional phone-match merge.
  **No `lib/firestore/leads.ts`** — there is no leads collection.
- `lib/firestore/ingestEvents.ts` — marker writes keyed by
  `${event_id}:${revision}`.
- `firestore.rules` — `ingest_events` is explicitly deny-all (Admin SDK only).
- `.env.example` + `README.md` document `EVENTS_AUDIENCE` and
  `EVENTS_ALLOWED_SERVICE_ACCOUNTS`.

Existing route shape to follow for validation/error mapping (but not auth):
`app/api/clients/route.ts` + `lib/api-server.ts`.

## Deployment

All three apps are Cloud Run; all deploy separately, from this one repo:

- tryzol.com: `gcloud run deploy zol-web --source apps/web --region us-west1`;
  provisioning via `apps/web/infra/*.ps1` (PowerShell, not Terraform),
  including the Cloud Scheduler jobs.
- Company OS: `gcloud builds submit --config cloudbuild.yaml` **from
  `apps/brain/`**, then the documented `gcloud run deploy company-os --image …`
  in `apps/brain/README.md`. Runs as the `company-os-runtime` service account.
- support: `apps/support/infra/deploy.ps1`.

The audience value on the sender and the service URL on the receiver must
match exactly; treat that URL as configuration on both sides. The failure
mode is visible: undelivered rows pile up with `delivered_at` null.

## First run, in order

The `gcloud` commands live in `apps/web/SETUP.md` and `apps/brain/SETUP.md`.
Each step is the check that makes the next one safe.

1. The monorepo branch is merged to `main`.
2. **Set `WAITLIST_READ_MIN_UPDATED_AT` before deploying the read endpoint.**
   It fails closed; set it deliberately, to a timestamp just before the first
   real submission.
3. **Deploy Company OS first, then the web app.** Consumer before producer.
4. **Submit the form once.** A client doc with `status: 'lead'` and
   `source: 'waitlist'` in Firestore is the integration working end to end.
5. **Resubmit the same email with a different phone.** Expected: the *same*
   client doc, `phone` updated, and a `pendingReview.phone` entry (reason
   `replaced`) in the CRM banner. A *second* client doc means the
   `phone_history` fallback is broken.
6. **Only then trigger reconcile once, with an explicit `since`.** On a fresh
   system it must come back all no-ops: `created: 0`, `merged: 0`,
   `duplicates: 1` per waitlist row, `failed: 0` (verified live 2026-08-28).
   If it writes anything, the floor or the marker keying is off.
