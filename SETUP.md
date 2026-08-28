# Setup — waitlist delivery to Company OS

Provisioning for the waitlist → Company OS integration, on the zol side.
Company OS has its own `SETUP.md` covering the receiving end; do that one
first, because the sweeper needs its URL and its runtime service account
before either half works.

Nothing here has been run. Every command needs real values substituted, and
they are ordered so that each one's output feeds the next.

**These commands create real infrastructure and deploy the live marketing
site.** Read them before running them.

---

## What this builds

```
Cloud Scheduler ──(OIDC, every 5 min)──▶ zol-web /api/waitlist/sweep
                                              │
                                              │ reads undelivered rows
                                              ▼
                                          Cloud SQL
                                              │
                                              │ (OIDC, aud = Company OS URL)
                                              ▼
                                       Company OS /api/events
```

Two separate identities, and it is worth being clear which is which:

- **`zol-scheduler`** is Cloud Scheduler's identity. It calls *into* the
  sweeper. The sweeper checks it against `COMPANY_OS_SCHEDULER_SERVICE_ACCOUNT`.
- **the zol-web runtime service account** is what the sweeper calls *out* as.
  Company OS checks it against its own `EVENTS_ALLOWED_SERVICE_ACCOUNTS`.

Confusing the two produces a 401 at whichever end you got wrong, with a message
that will not tell you which.

---

## 0. Prerequisites

```bash
gcloud auth login
```

```bash
gcloud config set project PROJECT_ID
```

```bash
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com iamcredentials.googleapis.com
```

You also need, from the Company OS side:

- its Cloud Run URL — `https://company-os-XXXXXX.REGION.run.app`
- its runtime service account, if you intend to check it from here

---

## 1. Apply the migration

`0005_waitlist_delivery.sql` adds `event_id`, `revision`, `delivered_at` and
`phone_history` to `waitlist_entries`, and marks every existing row delivered.

Migrations run from a laptop, never from CI — a Vercel build has no reliable
route to Cloud SQL, and migrating from CI races every preview deploy against
production's schema.

```bash
cd web && npm run db:status
```

```bash
cd web && npm run db:migrate
```

> **The backfill is deliberate.** Existing rows are stamped
> `delivered_at = now()` because they are out of scope, not because they are
> old. Do not "fix" this by clearing the column — see *Backfilling history*
> below.

---

## 2. Give the sweeper an identity to call out as

The sweeper mints an ID token from the metadata server, which means it calls
out as whatever service account `zol-web` runs as. Find it:

```bash
gcloud run services describe zol-web --region us-west1 --format="value(spec.template.spec.serviceAccountName)"
```

If that comes back empty, the service is running as the default compute service
account. Give it a dedicated one instead — the default is shared by everything
in the project, so allowlisting it on the Company OS side would allowlist far
more than this service:

```bash
gcloud iam service-accounts create zol-web-runtime --display-name="zol-web runtime"
```

```bash
gcloud run services update zol-web --region us-west1 --service-account zol-web-runtime@PROJECT_ID.iam.gserviceaccount.com
```

**Whichever address you end up with goes into Company OS's
`EVENTS_ALLOWED_SERVICE_ACCOUNTS`.** No IAM binding is needed for this — the
token is verified by signature and by claim, not by a permission grant.

---

## 3. Create Cloud Scheduler's identity

```bash
gcloud iam service-accounts create zol-scheduler --display-name="Waitlist sweep scheduler"
```

Scheduler needs permission to invoke the service only if `zol-web` is not
public. It currently is (`--allow-unauthenticated`), so this binding is
belt-and-braces — the sweeper does its own token check regardless, and that
check is what actually protects it:

```bash
gcloud run services add-iam-policy-binding zol-web --region us-west1 --member="serviceAccount:zol-scheduler@PROJECT_ID.iam.gserviceaccount.com" --role="roles/run.invoker"
```

---

## 4. Configure and deploy

```bash
gcloud run services update zol-web --region us-west1 --set-env-vars "COMPANY_OS_URL=https://company-os-XXXXXX.REGION.run.app,COMPANY_OS_SCHEDULER_SERVICE_ACCOUNT=zol-scheduler@PROJECT_ID.iam.gserviceaccount.com,COMPANY_OS_SWEEP_AUDIENCE=https://zol-web-XXXXXX.REGION.run.app/api/waitlist/sweep"
```

`COMPANY_OS_URL` must be the bare origin with no trailing slash and no path.
It is sent as the `audience` claim, and Company OS compares it to its own URL
character for character.

`COMPANY_OS_SWEEP_AUDIENCE` must match **exactly** what Cloud Scheduler is told
to mint in step 5, including the path. These two strings are compared, not
parsed.

Then deploy:

```bash
gcloud run deploy zol-web --source web --region us-west1 --allow-unauthenticated
```

---

## 5. Create the schedule

```bash
gcloud scheduler jobs create http waitlist-sweep --location us-west1 --schedule "*/5 * * * *" --uri "https://zol-web-XXXXXX.REGION.run.app/api/waitlist/sweep" --http-method POST --oidc-service-account-email "zol-scheduler@PROJECT_ID.iam.gserviceaccount.com" --oidc-token-audience "https://zol-web-XXXXXX.REGION.run.app/api/waitlist/sweep" --attempt-deadline 300s
```

`--oidc-token-audience` and `COMPANY_OS_SWEEP_AUDIENCE` are the same string.
If they differ by so much as a trailing slash, every run returns 401 and the
log line says `token did not verify` without saying why.

---

## 6. Check it

Run the job by hand rather than waiting five minutes:

```bash
gcloud scheduler jobs run waitlist-sweep --location us-west1
```

```bash
gcloud run services logs read zol-web --region us-west1 --limit 50
```

A working sweep logs `[sweep] N considered, N delivered, 0 rejected, 0 failed`.

Then submit the form once at https://tryzol.com and watch it arrive. A client
document with `status: 'lead'` and `source: 'waitlist'` in Company OS is the
whole integration working end to end.

### When it doesn't

| Symptom | Cause |
| --- | --- |
| `401` from the scheduler job | `--oidc-token-audience` ≠ `COMPANY_OS_SWEEP_AUDIENCE` |
| `[sweep] rejected caller: caller … is not allowed` | `COMPANY_OS_SCHEDULER_SERVICE_ACCOUNT` doesn't match `zol-scheduler@…` |
| `[sweep] … failed … HTTP 401` | Company OS's `EVENTS_ALLOWED_SERVICE_ACCOUNTS` doesn't list the zol-web runtime account, or `COMPANY_OS_URL` ≠ Company OS's own URL |
| `0 considered` after a submission | The row was written with `delivered_at` already set, or the migration hasn't been applied to that database |
| `rejected` with a 400 | Company OS refused the payload. The detail is in the log line; the row stays queued on purpose |

Undelivered rows are a query, not a mystery:

```bash
psql "$DATABASE_URL" -c "SELECT event_id, revision, email, created_at FROM waitlist_entries WHERE delivered_at IS NULL ORDER BY created_at"
```

---

## Rotating the Company OS URL

Cloud Run URLs change if the service is deleted and recreated. When that
happens the `audience` claim stops matching and every delivery 401s while the
rows pile up undelivered — visible, but only if you look.

Update `COMPANY_OS_URL` here and redeploy. Nothing needs replaying: the rows
are still queued and the next sweep sends them.

---

## Backfilling history

Waitlist entries that predate this integration were marked delivered by the
migration. They are **out of scope**, not merely old.

If they should end up in Company OS, that is a separate one-off script — not
`UPDATE waitlist_entries SET delivered_at = NULL`. Clearing the column would
hand the sweeper the entire back catalogue at fifty rows per five minutes with
no way to watch what it creates, and every one of those rows would arrive at
`occurred_at` values months in the past against clients that may already exist.
Write the script, log what it does, and run it where you can see it.
