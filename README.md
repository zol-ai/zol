# ZOL monorepo

Three apps, one repository. Each app was its own repo until November 2026 and
was imported here with its full commit history (`git subtree`); each still
builds, deploys, and runs on its own.

```
apps/
├── web/       tryzol.com — marketing site, waitlist, and Shop OS
│              Next.js + Postgres (Cloud SQL) · Cloud Run us-west1, also builds on Vercel
│              formerly github.com/zol-ai/zol
├── brain/     Company OS — internal dashboard; "Company Brain" is the agent inside it
│              Next.js + Firestore · Cloud Run us-central1 (service: company-os)
│              formerly github.com/zol-ai/company-brain
└── support/   Phone support agent — Twilio voice ↔ OpenAI Realtime, calls dashboard
│              Next.js (custom server.ts) + Postgres · Cloud Run
│              formerly github.com/zol-ai/zol-customer-support
```

Each app directory is its own deployable root: `package.json`, `Dockerfile`,
`.env.example`, and that app's `README.md`/`SETUP.md` live there, and the
container build context is the app directory alone.

## Running things

Node 22+ and **npm 11+**. One install at the root covers all three
workspaces:

```bash
npx -y npm@11 install
```

(npm 10.9, the version bundled with Node 22, crashes resolving this
workspace — an arborist bug hit by vitest 4's peer set: `Cannot read
properties of null (reading 'edgesOut')`. `npm ci` against the committed
lockfile is unaffected; it is fresh resolution that crashes.)

Per app (each reads `.env.local` from its own directory — copy that app's
`.env.example` and fill it in):

| | dev | build | test |
|---|---|---|---|
| tryzol.com | `npm run dev:web` | `npm run build:web` | `npm test -w apps/web` |
| Company OS | `npm run dev:brain` | `npm run build:brain` | `npm test -w apps/brain` |
| support | `npm run dev:support` | `npm run build:support` | — |

`npm run build` / `npm run typecheck` / `npm run lint` run across every
workspace. The dev servers all default to port 3000 (`dev:brain` passes
`-p 3001`), so run one at a time or pass `-- -p <port>`.

Database migrations stay per app: `npm run db:migrate:web` and
`npm run db:migrate:support`, run from a laptop, never from CI.

## Lockfiles — read before changing dependencies

Every app keeps **its own `package-lock.json`** because every deploy builds
from the app directory alone (Cloud Run / Docker never see the repo root).
The root `package-lock.json` only serves the root `npm install` and CI.

After changing any app's dependencies, refresh both:

```bash
npm install                                   # root lockfile
cd apps/<app> && npm install --workspaces=false   # that app's lockfile
```

## Deploys

Deploys are manual `gcloud` commands, documented per app — see
`apps/web/SETUP.md`, `apps/brain/README.md` + `apps/brain/SETUP.md`, and
`apps/support/README.md`. The build/deploy sources are now:

- tryzol.com (Cloud Run / telephony): `gcloud run deploy zol-web --source apps/web --region us-west1`
- tryzol.com (Vercel, the web traffic): auto-deploys via the Vercel Git
  integration (Root Directory `apps/web`); `cd apps/web && vercel --prod`
  and the inert `web deploy (Vercel)` workflow exist as fallbacks (see
  docs/deploy-cutover.md)
- Company OS: `gcloud builds submit --config cloudbuild.yaml` **run from
  `apps/brain/`**, then the `gcloud run deploy company-os --image …` command
  in its README
- support: `apps/support/infra/deploy.ps1` (builds with `--source` = the app)

The cutover from the old three-repo deploys is written up in
[docs/deploy-cutover.md](docs/deploy-cutover.md).

## CI

GitHub Actions workflows under `.github/workflows/` are path-filtered: a push
or PR only builds the app whose files changed. They build and test only —
nothing in CI deploys.
