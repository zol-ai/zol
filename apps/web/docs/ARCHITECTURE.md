# ZOL — architecture

Shop management software that does the work instead of just recording it: the
call, the booking, the check-in, the diagnosis and inspection, the estimate and
the customer's approval, the parts, the invoice and payment, and the follow-up
afterwards, on one record.

---

## Shape of the system

```
   customer ──── phone / text ────▶ ┌──────────────┐
   customer ──── /talk/<slug> ────▶ │  receptionist │──▶ appointment ──▶ check-in ──▶ ticket
   customer ◀─── /portal/<token> ── │   engine      │        │                          │
                                    └──────────────┘        │      diagnostics · inspection
                                                             │      lines · estimate · parts
                     ┌───────────────────────────┐           │      invoice · payment
                     │  follow-up worker (jobs)  │◀── queue ─┴──── history · notifications
                     │  Cloud Scheduler, 5 min   │
                     └─────────────┬─────────────┘
                                   ▼
                        messaging provider seam
                     Twilio (flag on) · portal only (flag off)

   ┌──────────────────────┐   ┌──────────────────────────┐   ┌───────────────┐
   │  web  (Vercel)       │   │  web  (Cloud Run)        │   │   PostgreSQL  │
   │  tryzol.com          │   │  same image, same code   │   │   Cloud SQL   │
   │  landing · app       │   │  scheduled jobs          │   │   one tenant  │
   │  portal · /talk      │   │  Twilio webhooks         │   │   per shop_id │
   └──────────┬───────────┘   └────────────┬─────────────┘   └───────▲───────┘
              └──────────────┬─────────────┘                          │
                             └────────────────────────────────────────┘
                                    OpenAI (optional, schema-validated)
                                    Stripe (optional, webhook-confirmed)
                                    Cloud Storage (optional, photos)
```

### Why the split

The marketing site, the app and the customer portal are ordinary
request/response work and belong on Vercel, where preview deployments per
branch are free and instant.

Scheduled work and telephony are not. Cloud Scheduler needs a stable URL it can
authenticate to with an OIDC token, and a phone call streams audio over a
WebSocket for the length of the call, which a serverless function will not
hold open. That half runs as a long-lived container on **Cloud Run**. It is the
same `web/` build (`web/Dockerfile`, `output: "standalone"`), so there is one
codebase and one Postgres.

---

## The seams

Three things a shop needs that aren't live yet each sit behind one module with
a working, labelled fallback. Nothing upstream of a seam knows which side is
active.

| Seam | Module | Fallback | Real thing |
| --- | --- | --- | --- |
| Talking to the customer | `web/src/lib/messaging/provider.ts` | portal-only: the message is written to the customer's repair page and the follow-up is marked sent | Twilio Messages API over `fetch`, chosen when `ZOL_TELEPHONY_ENABLED` and credentials are present |
| Taking a call | `web/src/lib/receptionist/engine.ts` | the web chat at `/talk/<slug>` and the test-call button drive the same engine | the realtime media service calls `finalizeVoiceCall` with the transcript — see [TELEPHONY.md](TELEPHONY.md) |
| Taking money | `web/src/lib/payments/` | a demo payment, labelled as such on every screen it touches | Stripe Checkout, confirmed by `/api/stripe/webhook` |
| Thinking | `web/src/lib/ai/client.ts` | every feature has a deterministic path when `OPENAI_API_KEY` is unset | `structuredCompletion`: JSON-schema response format, parsed with zod before anything is stored |
| Photos | `web/src/lib/storage/provider.ts` | upload controls don't render | Cloud Storage via the JSON API, `GCS_BUCKET` |

---

## How a job moves

Every change to a repair order goes through `web/src/lib/repair-orders-db.ts`:

- `openRepairOrder` is the only way a ticket is created (counter, check-in,
  receptionist). It numbers it from the shop's counter, links the appointment,
  updates the vehicle's mileage and writes the first history row.
- `transitionRepairOrder` is the only status change a button should call. It
  moves the ticket, writes the history row, queues the customer's journey
  message for the stops they care about (on the lift, waiting on parts, ready
  — with a portal link and the total) and tells the shop when a car is ready.
  The estimate and payment flows use the low-level `setRepairOrderStatus`
  because they send their own messages.
- `repair_order_events` is the ticket's history; every panel that changes
  anything writes one. `actor` is the app's one colour system — emerald for
  ZOL acting unattended, amber for a person.

Customer-facing messages are never sent from a page. They are queued as
`follow_ups` rows through `queueFollowUp` with wording from `journeyMessage`
(`web/src/lib/follow-ups.ts`), and the worker (`POST /api/jobs/follow-ups`,
Cloud Scheduler every five minutes, OIDC-authenticated like the waitlist
sweeper) drains them through the messaging seam and records the resulting
`messages` row. A redeploy cannot drop "your car is ready"; a STOP is checked
at send time, not queue time. The one exception is the explicit compose box on
a ticket — a person pressing Send expects it to go now.

Approval lives on the line. An estimate is a frozen, sent copy of the ticket's
lines; the customer's per-line answer from the portal is written back onto
`repair_order_lines.approval`, declined lines become `declined_work` (the
recall list), and totals count everything but declined lines. An invoice is a
second frozen copy — approved lines only — at the moment the work is done.

---

## The compliance gate

`ZOL_TELEPHONY_ENABLED` defaults to `false` and every webhook **fails closed**
while it is.

This is deliberate. Before a US number can make automated calls or send
application-to-person SMS at volume, Twilio requires carrier registration — A2P
10DLC brand and campaign vetting for messaging, plus the voice caller-ID steps.
Operating an unregistered number gets messages filtered and numbers blocked,
and the damage lands on the shop's phone number, not ours.

With the flag off:

- The voice webhook still verifies the signature, then answers with a voicemail
  prompt and `503`, instead of transacting.
- The SMS webhook still honours `STOP` and `HELP` — those are carrier
  requirements and must behave identically before and after registration. STOP
  sets `customers.sms_opted_out` and cancels that customer's pending follow-ups.
- Every message the product would have texted is written to the customer's
  portal page instead, and the follow-up is marked sent. Nothing is lost and
  nothing is faked.

Flipping the flag is the go-live step for texting. Voice additionally needs the
realtime media service.

---

## Security decisions worth keeping

**Every query is scoped by `shop_id` from the session**, never from a form or a
URL. A uuid pasted from another tenant's page narrows nothing on its own.

**Public surfaces authenticate themselves.** The portal resolves an opaque
token stored only as its SHA-256; `/talk/<slug>` is rate-limited per IP and
carries no personal data in the URL; Twilio webhooks are signature-verified
before any side effect (`web/src/lib/twilio-signature.ts`, HMAC-SHA1,
`timingSafeEqual`); the Stripe webhook verifies `Stripe-Signature` over the raw
body; the jobs route verifies a Google OIDC token and fails closed when
unconfigured.

**`ZOL_PUBLIC_URL` pins the signed origin.** Twilio signs the URL it was
configured to call. Behind Vercel and Cloud Run the inbound `Host` header is a
proxy host and TLS terminates upstream, so verifying against `request.url`
fails for reasons that look nothing like the real cause.

**Secrets are `server-only`.** `lib/env.ts` imports `server-only`, so importing
config into a client component is a build error rather than a leak.

**Opt-out is a database column, not a runtime check.** `customers.sms_opted_out`
gates every outbound message.

**AI output is data, not instructions.** It is parsed against a schema, never
executed, never allowed to write a price the shop didn't set, and always
labelled with its source. The model ranks causes; a technician verifies one,
and only that becomes an estimate.

---

## Data model notes

Baseline in [`db/schema.sql`](../db/schema.sql); everything since in
[`db/migrations/`](../db/migrations/). The decisions that are expensive to
change later:

- **Multi-tenant from the first migration.** Every tenant table carries
  `shop_id`. Retrofitting that later is a rewrite.
- **The phone number is the customer's identity** (`UNIQUE (shop_id, phone)`),
  because it is the only thing known when the phone rings.
- **Money is integer cents**, never float. Times are `timestamptz`; wall-clock
  booking renders from `shops.timezone`.
- **Bays cannot double-book.** A GiST exclusion constraint enforces it in the
  database, because the agent books slots concurrently with humans and
  last-write-wins would put two vehicles in one bay.
- **Numbers come from counters on the shop row** (`ro_number_seq`,
  `estimate_number_seq`, `invoice_number_seq`) behind a row lock, so two
  advisors can't hand out the same ticket number.
- **`declined_work` is its own table.** The job a customer said no to is the
  highest-value follow-up the product has, and it needs its own due date.
- **`follow_ups` are rows, not in-process timers**, so a redeploy cannot drop
  somebody's "your car is ready". The same table is the CRM's worklist.
- **Estimates and invoices are frozen copies** of the ticket's lines at the
  moment they went out, linked back line by line.
- **History is append-only** (`repair_order_events`, `messages`,
  `conversation_messages`).

---

## Local development

```bash
cd web && npm install && npm run dev
```

Copy `.env.example` to `.env.local` inside `web/` and fill in what you need.
The site renders with no keys at all; only the app needs a database.

Point `DATABASE_URL` at a Postgres 16 (a UTF-8 database), then:

```bash
cd web && npm run db:load && npm run db:migrate && node scripts/seed-demo.mjs
```

`npm test` runs the unit tests (`node:test`); `npm run typecheck` runs `tsc`.

---

## Deploying

**Vercel** — project root `web/`, framework preset Next.js, deploys from
`main`. Set the environment variables from `.env.example`. Every branch gets a
preview URL.

**Cloud Run** — build context is `web/`:

```bash
gcloud run deploy zol-web --source web --region us-west1 --allow-unauthenticated
```

Point Twilio's webhook URLs at the Cloud Run origin and set `ZOL_PUBLIC_URL`
on that deployment to the customer-facing origin (tryzol.com) so portal links
minted by the worker point where customers actually go. The scheduler jobs are
in [`../SETUP.md`](../SETUP.md).
