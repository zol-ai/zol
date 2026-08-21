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
- [x] **Run `db/schema.sql` against a real Postgres 16.** Loaded onto
      `zol-ai:us-west1:zol-pg`; twelve tables, no changes needed.
- [x] Stand up Postgres on GCP and wire it up — Cloud SQL, reached from
      Vercel with a federated OIDC token rather than a stored key
- [x] Migrations: `db/migrations/` plus `npm run db:migrate`, run from a
      laptop rather than from CI
- [x] **Sign-in.** Shops sign up, owners invite advisors and techs, sessions
      are rows so revocation is immediate. Shop settings, hours and the
      quote cap are editable.
- [x] Customers and vehicles: one search box over name, phone, plate, VIN
      and make; the phone number is the identity and a re-entry folds into
      the record that already exists
- [x] Repair orders: the board, the ticket, labour/part/fee/discount lines,
      totals derived from the lines, and the quote cap enforced on screen
      with a named human approving anything above it
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

- [x] Calendar: a day view per bay, booking that respects the no-overlap
      constraint, and arrive / no-show on the slot. What's left is the agent
      *offering* a slot, which needs the call path
- [ ] Estimate by SMS with the shop's branding
- [ ] Follow-up worker draining `follow_ups` (part ordered → on the lift →
      diagnosis → ready for pickup)
- [x] Declined work recorded from the ticket, with a recall list that
      surfaces each item at the interval the shop set. Chasing it
      automatically is the part waiting on the phone line 📞
- [ ] Shop dashboard: the board, repair order detail, call history
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
