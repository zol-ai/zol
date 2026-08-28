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
gcloud run services update company-os --region us-central1 --set-env-vars "EVENTS_AUDIENCE=https://company-os-XXXXXX.us-central1.run.app,EVENTS_ALLOWED_SERVICE_ACCOUNTS=zol-web-runtime@ZOL_PROJECT_ID.iam.gserviceaccount.com"
```

`--set-env-vars` replaces the whole set. If the service already carries
`FIREBASE_PROJECT_ID`, `ALLOWED_EMAILS` and `OPENAI_MODEL`, either include them
in the same flag or use `--update-env-vars` instead — replacing the set and
losing `ALLOWED_EMAILS` locks every human out of the workspace.

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

Unreviewed waitlist leads are hidden in `/clients` by default — the toggle is
above the table. A record with anything in `pendingReview` shows regardless of
that filter, because a disagreement on a record somebody already cared about is
not the same thing as unreviewed noise.

**Promotion is a status change**, not a copy: set `status` to `active` on the
same document. There is no `leads` collection, nothing moves between
collections, and `source` stays `waitlist` forever — it records how the record
arrived, which does not change because somebody later approved it.
