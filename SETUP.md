# Setup — receiving waitlist events

Provisioning for `POST /api/events`, the route that receives waitlist
submissions from tryzol.com. The zol repo has its own `SETUP.md` for the
sending half; **do this one first**, because that side needs this service's
URL before its sweeper can be configured.

Nothing here has been run. Substitute real values throughout.

**These commands deploy a live service.** Read them before running them.

---

## What this configures

```
zol-web (Cloud Run) ──(OIDC, aud = this service's URL)──▶ POST /api/events
                                                               │
                                                               ▼
                                                    clients / ingest_events
```

`/api/events` is the only route in this application that is not behind a
Firebase session. It verifies a Google-signed ID token instead, so two values
have to be right or nothing gets in:

- **`EVENTS_AUDIENCE`** — this service's own URL. The sender mints its token
  for this exact string, and the route compares it character for character.
- **`EVENTS_ALLOWED_SERVICE_ACCOUNTS`** — the service account `zol-web` runs
  as. Google will happily sign a token for any service account in existence;
  this list is what says which one we expected.

Both unset means the route refuses everything, which is the intended behaviour
of a half-configured deploy.

---

## 1. Deploy the rules and indexes

The new pieces are a deny rule for `ingest_events` and a composite index on
`clients` for `status` + `source` + `name`.

```bash
firebase use FIREBASE_PROJECT_ID
```

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

> The equality lookup on `clients.phone` needs no entry in
> `firestore.indexes.json` — Firestore indexes every single field
> automatically, and composite indexes are only for multi-field queries. The
> `status`/`source` composite is there for when the CRM filter moves
> server-side; today it is applied in the browser.

---

## 2. Find this service's URL

```bash
gcloud run services describe company-os --region us-central1 --format="value(status.url)"
```

That value is `EVENTS_AUDIENCE` here **and** `COMPANY_OS_URL` on the zol side.
Bare origin, no trailing slash, no path.

---

## 3. Find the sender's identity

From the zol project:

```bash
gcloud run services describe zol-web --region us-west1 --format="value(spec.template.spec.serviceAccountName)"
```

If that is empty, `zol-web` is running as the default compute service account.
Give it a dedicated one before allowlisting it here — the default is shared by
everything in that project, so trusting it means trusting all of them. The zol
`SETUP.md` covers this.

No IAM binding is needed in this project. The token is checked by signature and
claim, not by a permission grant, so the sender's service account needs no role
here at all.

---

## 4. Configure and deploy

```bash
gcloud run services update company-os --region us-central1 --update-env-vars "EVENTS_AUDIENCE=https://company-os-XXXXXX.us-central1.run.app,EVENTS_ALLOWED_SERVICE_ACCOUNTS=zol-web-runtime@ZOL_PROJECT_ID.iam.gserviceaccount.com"
```

`--update-env-vars`, never `--set-env-vars`. The latter replaces the service's
**entire** variable set — everything not named in the flag is deleted, and the
set of things this service needs grows over time, so any enumerated list here
would eventually be stale. Losing `ALLOWED_EMAILS` alone locks every human out
of the workspace.

Then build and deploy as usual:

```bash
gcloud builds submit --config cloudbuild.yaml --substitutions="_FIREBASE_API_KEY=API_KEY,_FIREBASE_AUTH_DOMAIN=PROJECT_ID.firebaseapp.com,_FIREBASE_APP_ID=APP_ID"
```

```bash
gcloud run deploy company-os --image us-central1-docker.pkg.dev/PROJECT_ID/company-os/company-os:BUILD_ID --region us-central1 --allow-unauthenticated --service-account company-os-runtime@PROJECT_ID.iam.gserviceaccount.com
```

---

## 5. Check it

The route cannot be exercised with `curl` alone — it needs a Google-signed
token minted for this service's audience. From a machine with `gcloud` and
permission to impersonate the sending service account:

```bash
gcloud auth print-identity-token --impersonate-service-account=zol-web-runtime@ZOL_PROJECT_ID.iam.gserviceaccount.com --audiences=https://company-os-XXXXXX.us-central1.run.app
```

An unauthenticated request should come back `401` with no detail:

```bash
curl -i -X POST https://company-os-XXXXXX.us-central1.run.app/api/events -H "Content-Type: application/json" -d '{}'
```

Then read the logs while the zol sweeper runs:

```bash
gcloud run services logs read company-os --region us-central1 --limit 50
```

A working ingest logs `[events] <uuid>:0 created <clientId>`. A second delivery
of the same event logs nothing — it returns 200 without touching Firestore,
which is the point.

### When it doesn't

| Log line | Cause |
| --- | --- |
| `EVENTS_AUDIENCE is not set` | The deploy dropped it. The route fails closed rather than accepting anonymous callers |
| `EVENTS_ALLOWED_SERVICE_ACCOUNTS is not set` | Same. An empty allowlist reads as nobody, never everybody |
| `caller … is not allowed` | The sender's runtime service account is not in the list — check the address, not the permissions |
| `token did not verify` | Almost always `aud`: `EVENTS_AUDIENCE` here and `COMPANY_OS_URL` on the zol side are not the same string |
| `unknown type …` | The sender is emitting an event type this build has no handler for. Returns 422; the row stays queued |
| `rejected: …` with field issues | The payload schema and the sender's payload have drifted. The named field is the drift |

---

## What lands in Firestore

A new shop creates one document in `clients`:

```jsonc
{
  "name": "Reyes Auto",              // from shop_name
  "contactName": "Dana Reyes",
  "contactEmail": "dana@example.com",
  "phone": "+16615550148",           // E.164, and the match key
  "zip": "93301",
  "bays": "4-6",
  "consentAt": "2026-08-27T18:04:11.221Z",
  "status": "lead",
  "source": "waitlist",
  "contacts": [{ "name": "…", "email": "…", "sourceEventId": "…" }],
  "lastInboundAt": "…"
}
```

and one in `ingest_events`, keyed `${event_id}:${revision}`.

Waitlist leads appear in `/clients` directly, marked with a `waitlist` badge —
there is no unreviewed filter. A record with anything in `pendingReview` also
raises a banner above the table asking for a decision.

**Promotion is a status change**, not a copy: set `status` to `active` on the
same document. There is no `leads` collection, nothing moves between
collections, and `source` stays `waitlist` forever — it records how the record
arrived, which does not change because somebody later approved it.

---

## Reconciliation

`POST /api/reconcile` pages through tryzol.com's `GET /api/waitlist/entries`
and replays each envelope through **this service's own** `POST /api/events`.
Nothing is duplicated: Postgres stays the source of truth for waitlist rows,
Firestore for client records, and the ingest transaction stays the only writer.

```
POST /api/reconcile
      │  (OIDC, aud = WAITLIST_SOURCE_URL)
      ▼
zol GET /api/waitlist/entries   ──▶ pages of envelopes
      │
      │  (OIDC, aud = EVENTS_AUDIENCE)  ← back into ourselves
      ▼
POST /api/events ──▶ ingest transaction ──▶ Firestore
```

### The self-call, and the two things it needs

> **This service's own runtime account must be in
> `EVENTS_ALLOWED_SERVICE_ACCOUNTS`.** Reconciliation authenticates to
> `/api/events` exactly like tryzol.com does, so it has to be on that list.
> Without it every replayed row comes back `401` and the run reports every row
> as failed.

> **Do not set this service to `--concurrency=1`.** A run holds one request
> open while making requests back to the same service. At concurrency 1 the run
> occupies the only slot and waits on a request that can never be scheduled —
> the job hangs until the platform timeout. The default (80) leaves ample room,
> and the job issues one self-request at a time.

### Configure

`--update-env-vars`, not `--set-env-vars`: the latter replaces the whole set
and would drop `ALLOWED_EMAILS`, locking every human out of the workspace.

```bash
gcloud run services update company-os --region us-central1 --update-env-vars "WAITLIST_SOURCE_URL=https://zol-web-XXXXXX.REGION.run.app,RECONCILE_ALLOWED_SERVICE_ACCOUNTS=company-os-scheduler@PROJECT_ID.iam.gserviceaccount.com"
```

```bash
gcloud run services update company-os --region us-central1 --update-env-vars "EVENTS_ALLOWED_SERVICE_ACCOUNTS=zol-web-runtime@ZOL_PROJECT_ID.iam.gserviceaccount.com,company-os-runtime@PROJECT_ID.iam.gserviceaccount.com"
```

`WAITLIST_SOURCE_URL` must equal `WAITLIST_READ_AUDIENCE` on the zol side
exactly — bare origin, no trailing slash. It is both the destination and the
`aud` claim.

### Trigger it by hand

A signed-in session works from the browser. From a terminal, use the scheduler
identity:

```bash
TOKEN=$(gcloud auth print-identity-token --impersonate-service-account=company-os-scheduler@PROJECT_ID.iam.gserviceaccount.com --audiences=https://company-os-XXXXXX.us-central1.run.app)
```

```bash
curl -s -X POST https://company-os-XXXXXX.us-central1.run.app/api/reconcile -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

Options, all optional: `since` (ISO timestamp), `cursor`, `pageSize` (≤500),
`maxPages` (≤200). An empty body reconciles everything.

The report distinguishes `created`, `merged`, `duplicates` and `failed`.
**`duplicates` dominating is the healthy result** — it means the push path
already delivered those rows and the two sides agree. A non-zero `created` on a
routine run means the push path missed something worth investigating.

If `truncated` is true the run hit its page ceiling. Resume it with the
`nextCursor` it returned:

```bash
curl -s -X POST https://company-os-XXXXXX.us-central1.run.app/api/reconcile -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"cursor":"<nextCursor from the previous run>"}'
```

### On a schedule

Optional, and slow on purpose. The push path is what delivers; this is the
safety net. Nightly is plenty — a tight loop just replays the whole queue
against Firestore for nothing.

```bash
gcloud iam service-accounts create company-os-scheduler --display-name="Company OS reconciliation"
```

```bash
gcloud scheduler jobs create http waitlist-reconcile --location us-central1 --schedule "17 4 * * *" --uri "https://company-os-XXXXXX.us-central1.run.app/api/reconcile" --http-method POST --headers "Content-Type=application/json" --message-body '{"since":"2026-01-01T00:00:00Z"}' --oidc-service-account-email "company-os-scheduler@PROJECT_ID.iam.gserviceaccount.com" --oidc-token-audience "https://company-os-XXXXXX.us-central1.run.app" --attempt-deadline 1800s
```

### When it doesn't

| Symptom | Cause |
| --- | --- |
| every row `failed` with `HTTP 401` | This service's own runtime account is missing from `EVENTS_ALLOWED_SERVICE_ACCOUNTS` |
| the run itself `401`s | The caller is not in `RECONCILE_ALLOWED_SERVICE_ACCOUNTS`, and there is no session |
| `WAITLIST_SOURCE_URL is not set` | Config dropped, most likely by a `--set-env-vars` that replaced the set |
| the read call `401`s | `WAITLIST_SOURCE_URL` ≠ zol's `WAITLIST_READ_AUDIENCE`, this service's runtime account is missing from zol's `WAITLIST_READ_ALLOWED_SERVICE_ACCOUNTS`, or zol's `WAITLIST_READ_MIN_UPDATED_AT` is unset — that endpoint refuses to serve without its floor |
| `malformed envelope` in `errors` | The payload schemas in the two repos have drifted. The named field is the drift |
| the run hangs and times out | Concurrency is set to 1 — see above |
