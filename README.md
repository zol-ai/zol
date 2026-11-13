# zol-customer-support

Phone support agent for Zol. A Twilio number answers, streams the caller's
audio to OpenAI's Realtime API, and streams the model's voice back. Every call
is logged to Postgres and shown in a small dashboard.

```
caller ──▶ Twilio number
             │  POST /api/twilio/voice          (TwiML: <Connect><Stream>)
             ▼
          web/server.ts  ──ws /media-stream──▶  CallBridge  ◀──ws──▶  OpenAI Realtime
             │                                     │
             │  POST /api/twilio/status            │  transcripts
             ▼                                     ▼
          Postgres (calls, call_turns)  ◀── summary/intent after hangup
             ▲
          dashboard  /  and  /calls/[id]
```

## Layout

```
web/
  server.ts                      custom Node server: Next + WebSocket upgrade
  src/lib/realtime/bridge.ts     Twilio <-> OpenAI audio bridge, one per call
  src/lib/agent/prompt.ts        the agent's instructions  <-- edit this
  src/lib/agent/summarize.ts     post-call summary + intent tagging
  src/lib/twilio/signature.ts    webhook signature verification
  src/app/api/twilio/voice       "a call comes in" webhook
  src/app/api/twilio/status      call status callback
  src/app/page.tsx               calls dashboard
  src/app/calls/[id]/page.tsx    transcript view
  db/migrations/                 SQL, applied with `npm run db:migrate`
```

## Local development

1. `cd web && cp .env.example .env.local`, fill in Twilio and OpenAI keys.
2. Start a tunnel: `ngrok http 3000` (or cloudflared). Put the https URL in
   `PUBLIC_BASE_URL`.
3. `npm run db:migrate` against a Postgres you control.
4. `npm run dev`.
5. In the Twilio console, on the phone number:
   - Voice → "A call comes in" → Webhook, `POST https://<tunnel>/api/twilio/voice`
   - Voice → "Call status changes" → `POST https://<tunnel>/api/twilio/status`
6. Call the number.

## Deploy (Cloud Run)

```
gcloud run deploy zol-support --source web --region us-west1 \
  --session-affinity --timeout 3600 --min-instances 1 \
  --set-env-vars PUBLIC_BASE_URL=https://<service-url>,TWILIO_PHONE_NUMBER=... \
  --set-secrets TWILIO_ACCOUNT_SID=...,TWILIO_AUTH_TOKEN=...,OPENAI_API_KEY=...,DATABASE_URL=...
```

WebSockets need the long request timeout and benefit from `--min-instances 1`
so the first caller does not hit a cold start.

## Relationship to the other Zol repos

Independent repository. If call records should reach Company OS, this service
POSTs to Company OS's events endpoint; data flows one way, from here to
Company OS, never back.
