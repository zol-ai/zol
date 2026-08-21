# ZOL

The AI front desk for independent auto repair shops. It answers every call
night and weekend, books the job, texts the estimate, chases the approval and
flags vendor delays — **on top of** the shop management software the shop
already runs (Tekmetric, Shopmonkey, Shop-Ware, Mitchell 1, AutoLeap), rather
than replacing it. No rip and replace is the core positioning.

```
zol/
├── web/          Next.js 16 — landing page, dashboard, Twilio webhooks
├── db/           PostgreSQL schema
├── infra/        Scripts that provision Cloud SQL and wire Vercel
├── docs/         Architecture, roadmap, deploy runbook
└── .env.example  Every environment variable the app reads
```

## Run it

```bash
cd web && npm install && npm run dev
```

The landing page renders with no configuration. Only the API routes need keys —
copy `.env.example` to `web/.env.local` and fill in what you need.

## Swapping the hero photos

The hero rotates through five images. The ones in `web/public/images/shop-0*.svg`
are hand-drawn placeholders — replace them with real photographs of your shops
(or licensed stock) whenever you have them.

1. Drop five landscape files, around 2000px wide, into `web/public/images/`.
2. Update the `src` extensions in `web/src/components/site/hero-media.tsx` and
   rewrite each `alt` to describe the actual photo.
3. Remove `unoptimized` from the `<Image>` in that file so Next.js resizes and
   serves WebP — that flag exists only because SVGs gain nothing from it.

Timing, crossfade, preloading and the dot controls all stay as they are.

## Deploy

Full runbook in [docs/DEPLOY.md](docs/DEPLOY.md). The short version, once
`gcloud auth login`, `gcloud auth application-default login` and `vercel login`
have been run:

```bash
pwsh ./infra/gcp-setup.ps1
```

```bash
pwsh ./infra/load-schema.ps1
```

```bash
pwsh ./infra/vercel-env.ps1
```

**Vercel** — project root `web/`. Every branch gets a preview URL.

**Cloud Run** — the same commit builds a container:

```bash
gcloud run deploy zol-web --source web --region us-west1 --allow-unauthenticated
```

## Telephony is deliberately switched off

`ZOL_TELEPHONY_ENABLED` defaults to `false`, and every Twilio webhook fails
closed while it is. Twilio's carrier registration (A2P 10DLC) hasn't cleared
yet, and running an unregistered number gets messages filtered and numbers
blocked — with the damage landing on the shop's phone number.

Signature verification, STOP/HELP handling, and the voicemail fallback all work
today. Flipping the flag is the go-live step.

## Documentation

- [Deploy](docs/DEPLOY.md) — the three cloud connections and how to make them
- [Architecture](docs/ARCHITECTURE.md) — how the pieces fit, and why the call
  path can't live on serverless
- [Roadmap](docs/ROADMAP.md) — what's built, what's next, what the risks are

## Book a demo

https://calendar.app.google/Q262bp3TVLBRcedm9
