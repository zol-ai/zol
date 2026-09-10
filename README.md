# ZOL

Shop management software that does the work instead of just recording it.
ZOL answers the phone night and weekend, books the job, checks the car in,
helps the tech diagnose and inspect it, texts the estimate, takes the approval
from the customer's phone, tracks the parts, invoices, takes payment and
follows up afterwards — one record from the first call to the next visit.

```
zol/
├── web/          Next.js 16 — landing page, the app, the customer portal, webhooks, jobs
├── db/           PostgreSQL schema and migrations
├── infra/        Scripts that provision Cloud SQL and wire Vercel
├── docs/         Architecture, roadmap, deploy runbook, telephony
└── .env.example  Every environment variable the app reads
```

## What's behind sign-in

A shop signs up at `/signup`, which creates the shop, its owner, a default week
of opening hours and a public handle (`/talk/<slug>`, where its customers can
reach the receptionist from the web). The owner invites advisors and techs from
**Team** and hands over the link.

| Section | What it does |
| --- | --- |
| Today | The day at a glance: appointments, what's in the shop, what needs a person, revenue, technician load |
| Calls | Every conversation ZOL has had — transcript, what it extracted, what it booked. A test-call button runs the real pipeline on a scripted call |
| Schedule | A day per bay, with technicians. Arrive → check-in → the ticket opens itself |
| Repair orders | The board, and the workbench: diagnostics, digital inspection, lines and approvals, estimate, parts, invoice, conversation, history |
| Inspections · Estimates · Parts · Invoices · Payments | Shop-wide views of the same records |
| Technicians | Each tech's queue, with one-tap status moves |
| Customers · Vehicles | The connected record: visits, messages, calls, declined work, lifetime value |
| Messages | Every thread with a customer, texts and portal messages alike |
| Follow-ups | The CRM: declined work, inspection recommendations, post-repair check-ins, birthdays, win-backs — drafted by ZOL, sent by the worker |
| Ask ZOL | Questions about the shop answered from its own data, with links to the record |
| Team · Settings | People, pricing, hours, the quote cap, and which integrations are live |

The customer never signs in. Every estimate and invoice text carries a link to
`/portal/<token>`: their car, its status, the inspection, the estimate to
approve line by line, and the invoice to pay.

Sessions are rows in Postgres, not signed tokens, so disabling somebody or
signing out takes effect on the very next request. Passwords are scrypt from
Node's standard library — no native module to fail at build time on Vercel.

## What runs without keys, and what lights up with them

Everything above works with only a database. Three integrations are seams
with a labelled fallback behind each:

| Integration | Without it | With it |
| --- | --- | --- |
| OpenAI (`OPENAI_API_KEY`) | Diagnostics, inspection summaries, estimate wording, follow-up drafts and the receptionist use deterministic, clearly labelled fallbacks | The same features answer through the model, validated against a schema before anything is stored |
| Twilio (`ZOL_TELEPHONY_ENABLED` + credentials) | Customer messages land on the customer's portal page only; nothing leaves the building | The same queued messages go out as texts; inbound texts reach the receptionist; STOP is honoured either way |
| Stripe (`STRIPE_SECRET_KEY`) | The portal records a clearly labelled demo payment so the paid → closed → follow-up chain can be exercised | Stripe Checkout, confirmed by webhook. ZOL never sees a card number |

Photos on inspections need a Cloud Storage bucket (`GCS_BUCKET`); without one
the upload controls simply don't render.

## Changing the schema

`db/schema.sql` is the baseline; everything after it is a numbered file in
`db/migrations/`, applied from a laptop rather than from CI:

```bash
cd web && npm run db:migrate
```

A Vercel build has no reliable route to Cloud SQL, and migrating from CI
races every preview deployment against production's schema. `npm run
db:status` lists what has and hasn't been applied. Migrations are additive and
safe to apply ahead of the code that uses them.

## Run it

```bash
cd web && npm install && npm run dev
```

The landing page renders with no configuration. For the app, point
`DATABASE_URL` at a Postgres 16, load the schema and migrations, and seed a
demo shop to click around in:

```bash
cd web && npm run db:load && npm run db:migrate && node scripts/seed-demo.mjs
```

Sign in as `owner@demo.zol` / `DemoShop2026!`. The seed refuses to run against
Cloud SQL. Unit tests: `npm test`. Types: `npm run typecheck`.

## Deploy

Full runbook in [docs/DEPLOY.md](docs/DEPLOY.md); the Cloud Scheduler jobs
(waitlist sweep, follow-up worker) are in [SETUP.md](SETUP.md).

**Vercel** — project root `web/`, deploys from `main`. This is tryzol.com: the
landing page, the app and the customer portal.

**Cloud Run** — the same commit builds a container:

```bash
gcloud run deploy zol-web --source web --region us-west1 --allow-unauthenticated
```

This is where the scheduled jobs run and where Twilio's webhooks point, because
a phone call needs a socket held open longer than a serverless function lives.

## Telephony is deliberately switched off

`ZOL_TELEPHONY_ENABLED` defaults to `false`, and every Twilio webhook fails
closed while it is. Twilio's carrier registration (A2P 10DLC) hasn't cleared
yet, and running an unregistered number gets messages filtered and numbers
blocked — with the damage landing on the shop's phone number.

Signature verification, STOP/HELP handling, the receptionist engine and the
messaging seam all work today. Flipping the flag is the go-live step for
texting; the voice path additionally needs the realtime media service
described in [docs/TELEPHONY.md](docs/TELEPHONY.md).

## Documentation

- [Deploy](docs/DEPLOY.md) — the three cloud connections and how to make them
- [Architecture](docs/ARCHITECTURE.md) — how the pieces fit, and the seams
  the integrations plug into
- [Telephony](docs/TELEPHONY.md) — what the flag flips on, and what the
  realtime service must call
- [Roadmap](docs/ROADMAP.md) — what's built, what's next, what the risks are

## Book a demo

https://calendar.app.google/Q262bp3TVLBRcedm9
