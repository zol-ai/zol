# Deploy cutover: three repos → one monorepo

What each hosting project needs after the `monorepo` branch merges to `main`
of `zol-ai/zol`. **Nothing in this document has been changed for you** — the
monorepo PR touches no deploy settings, no secrets, and no env vars. Until
you make the changes below, the old repos keep deploying exactly as before.

Repo visibility: `zol-ai/zol` went private during the merge (it absorbed
two private repos), then **public again** by decision on 2026-11-14 — see
the Vercel section. GitHub-side there was nothing else to move — none of
the three repos had Actions secrets, Actions variables, webhooks, or
(accessible) branch-protection rules.

Secret **values** are never listed here. Names only, with where each lives.

---

## apps/web — tryzol.com (was the repo root of zol-ai/zol)

### Cloud Run (primary) — service `zol-web`, region `us-west1`, project `zol-ai`

| Setting | Old | New |
| --- | --- | --- |
| Deploy command | `gcloud run deploy zol-web --source web --region us-west1` | `gcloud run deploy zol-web --source apps/web --region us-west1` |
| Repo | zol-ai/zol | zol-ai/zol (unchanged) |

That is the only change. The Dockerfile builds from the app directory alone,
so nothing inside the image moves. Run the command from the repo root.

**Cloud Scheduler jobs are untouched** — `waitlist-sweep` and `follow-ups`
(us-west1) target the service URL, not the repo. Do not recreate them.

**Env vars on the service (names, per `apps/web/.env.example`):**
`ZOL_TELEPHONY_ENABLED`, `ZOL_SIGNUP_CODE`, `ZOL_PUBLIC_URL`,
`ZOL_CUSTOMER_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_PHONE_NUMBER`, `ZOL_SUPPORT_NUMBER`, `ZOL_MEDIA_STREAM_URL`,
`OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TRANSCRIBE_MODEL`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GCS_BUCKET`,
`GCS_PUBLIC_BASE_URL`, `JOBS_SCHEDULER_SERVICE_ACCOUNT`, `JOBS_AUDIENCE`,
`INSTANCE_CONNECTION_NAME`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`,
`CLOUD_SQL_IP_TYPE`, `DATABASE_POOL_MAX`, `DEEPGRAM_API_KEY`,
`COMPANY_OS_URL`, `COMPANY_OS_SCHEDULER_SERVICE_ACCOUNT`,
`COMPANY_OS_SWEEP_AUDIENCE`, `COMPANY_OS_SWEEP_WINDOW_DAYS`,
`COMPANY_OS_SWEEP_BATCH_SIZE`, `WAITLIST_READ_ALLOWED_SERVICE_ACCOUNTS`,
`WAITLIST_READ_AUDIENCE`, `WAITLIST_READ_PAGE_SIZE`,
`WAITLIST_READ_MAX_PAGE_SIZE`, `WAITLIST_READ_MIN_UPDATED_AT`.
All already set on the service; a `--source` deploy does not clear them.

**GCP Secret Manager (project `zol-ai`):** `zol-db-password`. Unchanged.

### Vercel — serves tryzol.com's web traffic

History of this decision: the repo went private during the merge, which
broke Vercel Hobby's Git integration (it refuses private *org* repos).
On 2026-11-14 the repo was made **public again** by decision — no
proprietary-code concern, and a full-history sweep (filenames and every
blob on every branch, all three imported histories) found no committed
secrets, only `.env.example` templates. With a public repo the Git
integration works on Hobby, so it stays the primary deploy path.

In the Vercel project settings:

1. **Git:** stays connected to `zol-ai/zol`.
2. **At merge time — Build & Development Settings → Root Directory:**
   set to **`apps/web`**. The PR's red "Vercel" check is this setting
   still pointing at the old layout; it clears after the merge once the
   root directory is flipped. Do not flip early: pre-merge `main` still
   builds from the old layout.
3. Env vars stay exactly as they are.

Kept as a fallback (e.g. if the repo ever goes private again): the
`web deploy (Vercel)` workflow deploys production via the Vercel CLI on
pushes to `main` touching `apps/web/**`. It no-ops green until
`VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` repo secrets
exist (token from vercel.com → Account Settings → Tokens; the IDs from
`apps/web/.vercel/project.json` after `cd apps/web && vercel link`; set
each with `gh secret set <NAME> --repo zol-ai/zol`, pasting the value at
the prompt). A laptop `cd apps/web && vercel --prod` works too.

**Env vars on Vercel (pushed by `apps/web/infra/vercel-env.ps1`):**
`INSTANCE_CONNECTION_NAME`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`,
`GCP_SERVICE_ACCOUNT_JSON`, plus whichever app vars from the list above were
set by hand. Unchanged by the move.

### Migrations

`npm run db:migrate:web` from the repo root (or `npm run db:migrate` inside
`apps/web`). Laptop only, as before.

---

## apps/brain — Company OS (was zol-ai/company-brain)

### Cloud Build → Artifact Registry — project per `apps/brain/SETUP.md`, region `us-central1`

| Setting | Old | New |
| --- | --- | --- |
| Build command | `gcloud builds submit --config cloudbuild.yaml --substitutions=…` from the repo root | the same command, **run from `apps/brain/`** |
| Repo | zol-ai/company-brain | zol-ai/zol, directory `apps/brain` |

`cloudbuild.yaml` itself needed no change — the Docker build context is
whatever directory you submit.

**If you ever created a Cloud Build trigger** connected to the old GitHub
repo (none is documented, the README flow is manual): recreate it against
`zol-ai/zol` with *Included files filter* `apps/brain/**` and *Cloud Build
configuration file* `apps/brain/cloudbuild.yaml`. A trigger builds from the
repo root, so that cloudbuild.yaml would then need its docker `build` step
pointed at `apps/brain` instead of `.` — do that only in the trigger
scenario.

### Cloud Run — service `company-os`, runs as `company-os-runtime@…`

Unchanged: the `gcloud run deploy company-os --image …` command in
`apps/brain/README.md` deploys an image by name and never sees the repo.
Keep using `--update-env-vars`, never `--set-env-vars` (the README explains
why: a full replace silently strips the ingest configuration).

**Env vars on the service (names, per `apps/brain/.env.example`):**
`ALLOWED_EMAILS`, `COMPANY_TIME_ZONE`, `OPENAI_API_KEY` (via
`--set-secrets openai-api-key:latest`), `OPENAI_MODEL`,
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
(blank on Cloud Run — service identity), `NEXT_PUBLIC_FIREBASE_API_KEY`,
`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`,
`NEXT_PUBLIC_FIREBASE_APP_ID` (the `NEXT_PUBLIC_*` four are build-time
substitutions in cloudbuild.yaml), `EVENTS_AUDIENCE`,
`EVENTS_ALLOWED_SERVICE_ACCOUNTS`, `WAITLIST_SOURCE_URL`,
`RECONCILE_ALLOWED_SERVICE_ACCOUNTS`, and the reserved
`NEXTAUTH_URL`/`NEXTAUTH_SECRET`/`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.

**Firebase:** `firebase deploy --only firestore:rules,firestore:indexes` now
runs from `apps/brain/` (where `firebase.json` lives). Nothing else changes.

---

## apps/support — phone support agent (was zol-ai/zol-customer-support)

### Cloud Run — service `zol-support`, region `us-west1`, project `zol-ai`, SA `zol-support-runtime@…`

| Setting | Old | New |
| --- | --- | --- |
| Deploy | `infra/deploy.ps1` from the old repo root | `powershell -ExecutionPolicy Bypass -File apps/support/infra/deploy.ps1` from the monorepo root |

The script was updated in this PR to deploy from the app root (the old repo
nested the app under `web/`; the monorepo flattens it). It reads
`.env.local` from `apps/support/` now, not `apps/support/web/`.

**Twilio webhooks are untouched** — the voice/status/recording webhooks
point at the `zol-support` service URL, not at GitHub.

**Env vars (names, per `apps/support/.env.example`), stored as Secret
Manager secrets by `infra/gcp-setup.ps1` and bound by `deploy.ps1`:**
`PUBLIC_BASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_PHONE_NUMBER`, `OPENAI_API_KEY` (optionally
`OPENAI_REALTIME_MODEL`, `OPENAI_VOICE`, `OPENAI_SUMMARY_MODEL`),
`DATABASE_URL`, `HANDOFF_PHONE_NUMBER`, `RECORD_CALLS`,
`DASHBOARD_PASSWORD`. (`SKIP_TWILIO_SIGNATURE` is local-tunnel only — never
in production.)

---

## After the deploys are confirmed from the monorepo

Only then, and only on your say-so (commands ready, nothing run):

```
gh repo archive zol-ai/company-brain
gh repo archive zol-ai/zol-customer-support
```

Archiving is reversible (`gh repo unarchive`), but do it last: an archived
repo is read-only, which would break any still-configured deploy that pulls
from it.

Open branches on the old repos at cutover time, for reference:
`zol-ai/zol` also carried `shop-os`, `sms-opt-in-and-terms`, and
`zol-support-sms-program` — branches created before the monorepo move apply
to the old paths and need rebasing onto `main` after the merge (their
`web/…` paths become `apps/web/…`).
