# ZOL — architecture

The AI front desk for independent auto repair shops. It answers the phone night
and weekend, books the job, texts the estimate, chases the approval, and flags
vendor delays.

**Positioning:** ZOL sits *on top of* the shop management software a shop
already runs — Tekmetric, Shopmonkey, Shop-Ware, Mitchell 1, AutoLeap — and
syncs customers, vehicles and repair orders both ways. Those systems record the
work; ZOL does the work nobody has time for. "No rip and replace" is the core
promise, so the data model treats an external system of record as the normal
case, not the exception.

---

## Shape of the system

```
                    ┌──────────────┐
   caller ─────────▶│    Twilio    │  voice + SMS
                    └──────┬───────┘
                           │ signed webhooks
              ┌────────────┴─────────────┐
              ▼                          ▼
   ┌──────────────────────┐   ┌──────────────────────────┐
   │  web  (Vercel)       │   │  realtime  (Cloud Run)   │
   │  ──────────────      │   │  ──────────────────      │
   │  landing page        │   │  holds the call's        │
   │  shop dashboard      │   │  media stream open       │
   │  webhook handlers    │   │  speech ⇄ model ⇄ speech │
   └──────────┬───────────┘   └────────────┬─────────────┘
              │                            │
              └──────────┬─────────────────┘
                         ▼
              ┌────────────────────┐        ┌───────────────┐
              │  PostgreSQL        │        │    OpenAI     │
              │  (self-hosted GCP) │        │  diagnose,    │
              │  shops, customers, │        │  quote, write │
              │  ROs, calls, msgs  │        └───────────────┘
              └────────────────────┘
```

### Why the split

The marketing site and dashboard are ordinary request/response work and belong
on Vercel, where preview deployments per branch are free and instant.

A phone call is not request/response. Twilio streams audio over a WebSocket for
the length of the call, and a serverless function will not hold that socket
open. That half runs as a long-lived container on **Cloud Run**, which is also
where the notes put it.

Both halves live in **one Git repository** and read one Postgres. `web/` builds
for either target: Vercel uses its own pipeline, and `web/Dockerfile` produces
a Cloud Run image from the same commit via `output: "standalone"`.

---

## What exists today

| Piece | Where | State |
| --- | --- | --- |
| Landing page | `web/src/app/page.tsx` + `web/src/components/site/` | Built |
| Health probe | `web/src/app/api/health/route.ts` | Built, verified |
| Twilio signature verification | `web/src/lib/twilio-signature.ts` | Built, verified |
| Voice webhook | `web/src/app/api/twilio/voice/route.ts` | Parked behind flag |
| SMS webhook + STOP/HELP | `web/src/app/api/twilio/sms/route.ts` | Built, verified |
| Diagnosis + quoting | `web/src/lib/agent/diagnose.ts` | Written, not yet run against the API |
| Database schema | `db/schema.sql` | Written, not yet run against a server |
| Cloud Run image | `web/Dockerfile` | Written, not yet built |
| Realtime media service | — | Not started |

Anything marked "not yet run" has never executed. Treat it as a considered
starting point, not as tested code.

---

## The compliance gate

`ZOL_TELEPHONY_ENABLED` defaults to `false` and every webhook **fails closed**
while it is.

This is deliberate. Before a US number can make automated calls or send
application-to-person SMS at volume, Twilio requires carrier registration — A2P
10DLC brand and campaign vetting for messaging, plus the voice caller-ID steps.
Operating an unregistered number gets messages filtered and numbers blocked,
and the damage lands on the shop's phone number, not ours.

So the code is written and the switch is off. With the flag off:

- The voice webhook still verifies the signature, then answers with a voicemail
  prompt and `503`, instead of transacting.
- The SMS webhook still honours `STOP` and `HELP` — those are carrier
  requirements and must behave identically before and after registration.

Flipping the flag to `true` is the whole go-live step for the webhook layer.

---

## Security decisions worth keeping

**Every Twilio webhook is signature-verified before it does anything.** These
URLs are public; without verification a stranger could make ZOL text a shop's
entire customer list. `web/src/lib/twilio-signature.ts` implements Twilio's
HMAC-SHA1 scheme directly against `node:crypto` and compares with
`timingSafeEqual`. Verified against tampering: a body altered after signing is
rejected.

**`ZOL_PUBLIC_URL` pins the signed origin.** Twilio signs the URL it was
configured to call. Behind Vercel and Cloud Run the inbound `Host` header is a
proxy host and TLS terminates upstream, so verifying against `request.url`
fails for reasons that look nothing like the real cause.

**Secrets are `server-only`.** `lib/env.ts` imports `server-only`, so importing
config into a client component is a build error rather than a leak.

**Opt-out is a database column, not a runtime check.** `customers.sms_opted_out`
gates every outbound message. A queued follow-up must not go out after somebody
replied STOP.

---

## Data model notes

Full schema in [`db/schema.sql`](../db/schema.sql). The decisions that are
expensive to change later:

- **Multi-tenant from the first migration.** Every tenant table carries
  `shop_id`. Retrofitting that later is a rewrite.
- **The phone number is the customer's identity** (`UNIQUE (shop_id, phone)`),
  because it is the only thing known when the phone rings.
- **Money is integer cents**, never float. Times are `timestamptz`; wall-clock
  booking renders from `shops.timezone`.
- **Bays cannot double-book.** A GiST exclusion constraint enforces it in the
  database, because the agent books slots concurrently with humans and
  last-write-wins would put two vehicles in one bay.
- **`declined_work` is its own table.** The job a customer said no to is the
  highest-value follow-up the product has, and it needs its own due date.
- **`follow_ups` are rows, not in-process timers**, so a redeploy cannot drop
  somebody's "your car is ready".

---

## Local development

```bash
cd web && npm install && npm run dev
```

Copy `.env.example` to `.env.local` inside `web/` and fill in what you need.
The site renders with no keys at all; only the API routes require them.

Load the schema into a local Postgres:

```bash
docker run --name zol-pg -e POSTGRES_PASSWORD=zol -p 5432:5432 -d postgres:16
```

```bash
psql postgresql://postgres:zol@localhost:5432/postgres -f db/schema.sql
```

---

## Deploying

**Vercel** — project root `web/`, framework preset Next.js. Set the environment
variables from `.env.example`. Every branch gets a preview URL.

**Cloud Run** — build context is `web/`:

```bash
gcloud run deploy zol-web --source web --region us-west1 --allow-unauthenticated
```

Point Twilio's webhook URLs at whichever origin is authoritative, and set
`ZOL_PUBLIC_URL` on that deployment to the same origin.
