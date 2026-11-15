# zol-customer-support

Phone support agent for Zol. A Twilio number answers, streams the caller's
audio to OpenAI's Realtime API, and streams the model's voice back. Every call
is logged to Postgres and shown in a small dashboard.

```
caller ──▶ Twilio number
             │  POST /api/twilio/voice          (TwiML: <Connect><Stream>)
             ▼
          server.ts  ──ws /media-stream──▶  CallBridge  ◀──ws──▶  OpenAI Realtime
             │                                     │
             │  POST /api/twilio/status            │  transcripts
             ▼                                     ▼
          Postgres (calls, call_turns)  ◀── summary/intent after hangup
             ▲
          dashboard  /  and  /calls/[id]
```

## Layout

```
apps/support/
  server.ts                      custom Node server: Next + WebSocket upgrade
  src/lib/realtime/bridge.ts     Twilio <-> OpenAI audio bridge, one per call
  src/lib/agent/prompt.ts        default instructions; live copy edited at /settings
  src/lib/settings.ts            agent_settings row (instructions, voice)
  src/lib/twilio/client.ts       Twilio REST: start recording, transfer to human
  src/proxy.ts                   password gate for the dashboard
  src/lib/agent/summarize.ts     post-call summary + intent tagging
  src/lib/twilio/signature.ts    webhook signature verification
  src/app/api/twilio/voice       "a call comes in" webhook
  src/app/api/twilio/status      call status callback
  src/app/api/twilio/recording   recording status callback
  src/app/api/recordings/[id]    streams a recording from Twilio (needs login)
  src/app/settings               edit the agent prompt and voice on the web
  src/app/login                  dashboard sign-in
  src/app/page.tsx               calls dashboard
  src/app/calls/[id]/page.tsx    transcript view
  db/migrations/                 SQL, applied with `npm run db:migrate`
```

## Local development

1. `cp .env.example .env.local`, fill in Twilio and OpenAI keys.
2. Start a tunnel: `ngrok http 3000` (or cloudflared). Put the https URL in
   `PUBLIC_BASE_URL`.
3. `npm run db:migrate` against a Postgres you control.
4. `npm run dev`.
5. In the Twilio console, on the phone number:
   - Voice → "A call comes in" → Webhook, `POST https://<tunnel>/api/twilio/voice`
   - Voice → "Call status changes" → `POST https://<tunnel>/api/twilio/status`
   Recording callbacks are set per call by the code; nothing to configure.
6. Call the number.

## Features

- **Editable prompt.** `/settings` saves the agent instructions and voice to
  Postgres; the next call picks them up. Operational notes (recording
  disclosure, transfer tool) are appended by code and shown read-only there.
- **Human handoff.** When `HANDOFF_PHONE_NUMBER` is set the model gets a
  `transfer_to_human` tool. On use, the call's TwiML is swapped for a `<Dial>`
  to that number with the Zol number as caller ID; no answer in 25s plays an
  apology and hangs up.
- **Recording.** With `RECORD_CALLS=true` every call is recorded (dual channel)
  and the greeting discloses it. Recordings play inline on the call page via a
  server proxy, so Twilio credentials never reach the browser.
- **Login.** One shared `DASHBOARD_PASSWORD`; Twilio webhooks are exempt and
  verify their own signatures.

## Deploy (Cloud Run)

One-time provisioning, then deploys, both from a laptop after `gcloud auth login`:

```
powershell -ExecutionPolicy Bypass -File infra/gcp-setup.ps1   # SA, DB on zol-pg, secrets from .env.local
powershell -ExecutionPolicy Bypass -File infra/deploy.ps1      # build, deploy, migrate, pin PUBLIC_BASE_URL
```

The service runs as `zol-support-runtime@zol-ai`, reaches Postgres through the
Cloud SQL socket on the existing `zol-pg` instance (database `zol_support`), and
reads every secret from Secret Manager. Migrations run as the Cloud Run job
`zol-support-migrate` on the same image, so no laptop needs database access.
WebSockets need the long request timeout and `--min-instances 1` keeps the
first caller off a cold start.

## Relationship to the other Zol repos

Independent repository. If call records should reach Company OS, this service
POSTs to Company OS's events endpoint; data flows one way, from here to
Company OS, never back.
