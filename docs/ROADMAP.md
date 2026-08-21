# ZOL — roadmap

Ordered by what unblocks the next thing, not by what's most fun to build.

---

## Now — while carrier registration is pending

Twilio's A2P 10DLC brand and campaign vetting takes days to weeks and blocks
every live-call milestone. Start it before anything else on this list, then
build against it.

- [ ] **File Twilio A2P 10DLC registration** (brand → campaign) and the voice
      caller-ID steps. Everything below with a 📞 waits on this.
- [x] Landing page with a working "Book a demo" path
- [x] Webhook signature verification, verified against tampering
- [x] STOP / HELP handling (carrier requirement, correct before go-live)
- [x] Schema designed
- [ ] **Run `db/schema.sql` against a real Postgres 16.** It has never
      executed — expect to fix something.
- [ ] Stand up Postgres on GCP and wire `DATABASE_URL`
- [ ] Pick a query layer and generate types from the schema
- [ ] Run `diagnose.ts` against the real API with ten transcripts from actual
      shop calls, and check the quotes against what the shop would have charged

---

## Next — the call actually works 📞

- [ ] Realtime media service on Cloud Run: Twilio media stream ⇄ speech ⇄ model
- [ ] `<Connect><Stream>` TwiML pointed at it (`ZOL_MEDIA_STREAM_URL`)
- [ ] Business-hours routing: hand to the counter during hours, answer outside
- [ ] Caller lookup on `From` before the first word, so it opens with the truck
- [ ] Write the call to `calls`, open the repair order, persist the transcript
- [ ] Confidence floor: below it, stop talking and take a message
- [ ] Quote cap: above `auto_quote_cap_cents`, a human approves before it's said

**Done when:** a real call to a real shop's number produces a correct, priced
repair order with nobody watching.

---

## Then — the rest of the job

- [ ] Calendar: real availability, hold a bay, respect the no-overlap constraint
- [ ] Estimate by SMS with the shop's branding
- [ ] Follow-up worker draining `follow_ups` (part ordered → on the lift →
      diagnosis → ready for pickup)
- [ ] Declined-work recall at the interval the shop sets
- [ ] Shop dashboard: the board, repair order detail, call history, customers
- [ ] Ask-anything panel that navigates to the record it answered about
- [ ] Walk-in intake so a customer at the counter can type their own details

---

## Later

- [ ] Holiday and birthday campaigns the owner pushes from the dashboard
- [ ] Shop management system integrations (Tekmetric, Shop-Ware, Mitchell1)
- [ ] Multi-location groups under one owner
- [ ] Spanish-language calls
- [ ] Per-shop tuning on its own historical repair orders

---

## Known risks

**Diagnosis quality is the whole product.** A confidently wrong cause quoted to
a customer costs the shop money and trust. The confidence floor and quote cap
exist for this; keep them conservative until there's evidence.

**Carrier filtering.** Even after registration, messaging that reads like
marketing gets filtered. Keep transactional follow-ups and promotional
campaigns on separate messaging services so a promo can't poison delivery of
"your car is ready".

**Recordings are two-party-consent territory.** Several states require
disclosure before recording a call. The opening line needs to handle this per
shop, per state, before recordings are switched on.

**Vercel can't host the call.** Don't let the realtime path drift onto
serverless — it won't hold the socket.
