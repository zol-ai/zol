# Telephony

How a phone call or a text becomes a booking, what is wired today, and what
the missing piece has to do.

## The one engine

Every channel ends in `web/src/lib/receptionist/engine.ts`:

| Function | Who calls it | What it does |
| --- | --- | --- |
| `startConversation({ shopId, channel, phone?, ip? })` | web chat API, SMS webhook | Opens a `conversations` row, stores the greeting as the first line. |
| `handleTurn({ conversationId, text })` | web chat API, SMS webhook | Records the customer's line, asks the model (or the fallback state machine) for the reply, stores it, and books when enough is known. |
| `finalizeConversation({ conversationId, callId? })` | `handleTurn`, `finalizeVoiceCall` | Extracts the intake, matches or creates the customer by phone and the vehicle by year/make/model, finds a slot, inserts the appointment, queues the confirmation, notifies staff, closes the conversation. |
| `finalizeVoiceCall({ shopId, callSid, from, to, transcript, durationSeconds, recordingUrl? })` | **the realtime media service** (future), the test-call button (today) | Writes the `conversations` and `calls` rows from a finished transcript and runs `finalizeConversation`. Idempotent on `callSid`. |

The per-turn brain is `web/src/lib/ai/receptionist.ts`; intake extraction is
`web/src/lib/receptionist/intake.ts`; the slot rules are
`web/src/lib/receptionist/scheduling.ts`. All three run without an OpenAI key
through deterministic fallbacks and label the result `fallback` wherever it is
shown. With `OPENAI_API_KEY` set the model runs the conversation and the
extraction, and the keyword classifier stays underneath it as a floor on
urgency — a model that calls "no brakes" routine does not get the last word.

Rules that hold on every channel:

- ZOL never diagnoses, never quotes, never invents a time. The scheduler books;
  the sentence that states the time is composed from the row it wrote.
- If the caller describes something unsafe (flashing light, smoke, brake or
  steering failure), ZOL says plainly not to drive it, marks the conversation
  `escalated`, and puts a `call` notification on the shop's bell. The booking
  still goes ahead so a tow-in has somewhere to land.
- Every customer-facing message goes through `queueFollowUp`; the follow-up
  worker sends it and checks `sms_opted_out` again at send time.

## What is wired today

| Piece | File | State |
| --- | --- | --- |
| Public web chat | `web/src/app/talk/[slug]/page.tsx`, `web/src/app/api/receptionist/route.ts` | **Live.** Rate-limited per connecting IP (20 new conversations an hour, across every shop; the IP is the *last* `x-forwarded-for` entry, the one the platform appended) and per conversation (80 messages). No personal data in URLs. A phone number typed here is unverified: the web channel never greets by name, never offers the vehicles on file, and never fills blanks on a record already on file — only Twilio-attested channels do. |
| Test call | `web/src/app/actions/calls.ts` → `finalizeVoiceCall` | **Live.** Scripted transcripts in `lib/receptionist/scripts.ts`; `calls.simulated = true`; excluded from rates. |
| SMS webhook | `web/src/app/api/twilio/sms/route.ts` | Signature-verified. STOP/HELP/START always honoured. Receptionist replies only when the flag is on. |
| Voice webhook | `web/src/app/api/twilio/voice/route.ts` | Signature-verified. Voicemail while the flag is off; `<Connect><Stream>` to `ZOL_MEDIA_STREAM_URL` when it is on. |
| Realtime media service | — | **Not started.** See the contract below. |

Both webhooks return 503 when `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are
missing: without the auth token there is no way to tell Twilio from a
stranger, so there is nothing they can safely do.

## The flag: `ZOL_TELEPHONY_ENABLED`

Off (the default) until Twilio's A2P 10DLC brand and campaign registration is
approved. An unregistered number that texts customers gets filtered and then
blocked, with the damage landing on the shop.

| | Off | On |
| --- | --- | --- |
| Outbound texts (`lib/messaging/provider.ts`) | Portal-only: the message is written to the customer's repair page and nothing leaves the building. | Twilio over REST, from the shop's `twilio_number` or the platform number. |
| Inbound SMS | STOP/HELP/START answered; everything else `503` with an empty `<Response>`. | Threaded onto the customer's open SMS conversation (`conversations` where `channel = 'sms'`, `phone = From`, status open/escalated) or a new one; `handleTurn` runs; the reply goes back as `<Message>`. A customer who has texted STOP gets no reply: the text is recorded and staff are told to call. A re-delivered webhook (same `MessageSid`) is answered again unless a reply already went out for it. |
| Inbound voice | Voicemail prompt, `<Record>`, `503`. | `<Connect><Stream url=ZOL_MEDIA_STREAM_URL>` with `callSid`, `from`, `to` as stream parameters. If the URL is unset, the same voicemail with a 200. |

Nothing upstream changes when the flag flips: the same queued rows start
going out as texts, and the same engine starts answering by SMS.

## The realtime media service: contract

The service does not exist yet. When it is built (Cloud Run, because Vercel
will not hold a WebSocket for the length of a call), this is what it must do:

1. Accept Twilio's media stream WebSocket at `ZOL_MEDIA_STREAM_URL`. The
   `start` event carries `customParameters` with `callSid`, `from` and `to`
   from the voice webhook.
2. Run the conversation in real time against the model — greeting from
   `greetingFor(shopName, "voice")`, the same rules as
   `lib/ai/receptionist.ts`'s system prompt — and keep a transcript as it goes.
3. When the call ends (`stop` event or hangup), call **`finalizeVoiceCall`**
   once with:

   ```ts
   {
     shopId: string;          // resolved from `to` via shops.twilio_number
     callSid: string;         // Twilio CallSid — the idempotency key
     from: string;            // caller, as Twilio gave it; normalised inside
     to: string;              // the shop's line
     transcript: { role: "assistant" | "customer" | "system"; content: string }[];
     durationSeconds: number;
     recordingUrl?: string | null;
     startedAt?: Date;        // defaults to now - durationSeconds
   }
   ```

   It returns `{ callId, conversationId, outcome: "booked" | "escalated", booking?, intake, intakeSource }`.

   How it calls it is an open decision. Two honest options: (a) the media
   service is a second deployment of this repo and imports the function
   directly, sharing the database; (b) an authenticated internal route on
   `zol-web` (Google OIDC from the Cloud Run metadata server, the same door
   the waitlist sweeper uses) that takes this payload and calls the function.
   Either way the function is the contract, not an HTTP shape.

4. Retries are safe: a second call with the same `callSid` returns the
   existing row and books nothing.

The test-call button pushes a scripted transcript through step 3 exactly,
which is why a working test call is evidence the rest of the pipeline works.

## STOP and opt-out

Carrier rules, enforced in our own table so the follow-up worker sees them:

- `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT` (case-insensitive,
  the whole message) → `customers.sms_opted_out = true`,
  `sms_opted_out_at = now()` for the customer whose phone is `From` at the
  shop whose `twilio_number` is `To`; every `pending` follow-up for that
  customer is cancelled; any open SMS conversation with the receptionist is
  marked `abandoned`. The reply is the carrier-required confirmation. An
  unknown number gets the same reply and flags nothing.
- **On the platform number.** A shop with no `twilio_number` texts from
  `TWILIO_PHONE_NUMBER`, so a STOP can arrive with `To` naming no shop. It is
  then applied at **every** shop that has no line of its own and has that
  phone on file — flag, cancelled follow-ups, abandoned threads, the same as
  above. The customer opted out of the number; every shop that texts from it
  is bound. `START` on the platform number opts them back in at the same set.
- `START`, `UNSTOP`, `YES` → `sms_opted_out = false`, `sms_opted_out_at = NULL`.
- `HELP`, `INFO` → the service-line text with STOP instructions.
- These three are answered **whether or not** the telephony flag is on.
- An opted-out customer can still be booked (at the counter, by the web chat,
  by a call); the confirmation is simply not queued, the schedule shows
  "texts stopped", and staff are told to confirm by phone. Opt-out is the
  law; a booking is not a text.
- An opted-out customer who texts anything else gets **no reply** from the
  receptionist — the same rule the composer and the follow-up worker apply.
  The inbound text is kept in their message history and a `message`
  notification tells staff it needs a call.

## Environment

| Variable | Used by |
| --- | --- |
| `ZOL_TELEPHONY_ENABLED` | Both webhooks, the messaging provider. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Signature verification; outbound sends. |
| `TWILIO_PHONE_NUMBER` | Platform sending number when a shop has no `twilio_number`. |
| `ZOL_PUBLIC_URL` | Rebuilds the exact URL Twilio signed behind a proxy. |
| `ZOL_MEDIA_STREAM_URL` | The voice webhook's `<Stream>` target. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | The receptionist's model. Absent → deterministic fallback, labelled. |
