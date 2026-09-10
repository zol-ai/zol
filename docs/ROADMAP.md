# ZOL — roadmap

Ordered by what unblocks the next thing, not by what's most fun to build.

---

## Built — the shop operating system

Landed 2026-09-10 as migrations 0007–0012 and the screens behind them. Every
item works today against a database alone; the integrations light up with a
key (see the README).

- [x] Sign-in, team invites, shop settings, hours, the quote cap
- [x] Customers and vehicles, one search box, the connected record
- [x] Schedule: a day per bay, technicians, confirm / arrive / no-show, and
      check-in that opens the ticket
- [x] The receptionist engine: intake → customer and vehicle match → earliest
      open slot (hours, bays, technician specialty) → booking → confirmation.
      Driven today by the web chat at `/talk/<slug>` and the test-call button;
      the voice path plugs into `finalizeVoiceCall`
- [x] Calls: transcript, extracted intake, booking, the customer's journey
- [x] Repair orders: the board, the workbench, history on every change
- [x] AI-assisted diagnostics with technician verification, and a fallback
      that never invents a fault
- [x] Digital inspection: thirteen systems, green/yellow/red, notes,
      measurements, photos when storage is configured, a summary grounded in
      the entered items, recommendations that become follow-ups
- [x] Lines with approval on the line; estimate as a frozen copy; the customer
      portal with per-line approve/decline; declined lines onto the recall list
- [x] Parts from needed to installed, with the ticket moving to and from
      "waiting on parts" on its own
- [x] Invoices from approved lines; manual, demo and Stripe payments; paid →
      closed → receipt → post-repair check-in
- [x] Follow-ups as the CRM: declined recalls, inspection recommendations,
      post-repair, birthdays, win-backs, drafted by ZOL, sent by the worker
- [x] Messaging seam: portal-only until carrier registration, Twilio after,
      STOP honoured either way
- [x] Today dashboard, notifications, global search, Ask ZOL
- [x] Migrations, seed, unit tests, health probe that reports each seam

---

## Now — while carrier registration is pending

Twilio's A2P 10DLC brand and campaign vetting takes days to weeks and blocks
every live-call milestone.

- [ ] **File Twilio A2P 10DLC registration** (brand → campaign) and the voice
      caller-ID steps. Everything with a 📞 waits on this.
- [ ] Set `OPENAI_API_KEY` on both deployments and read the first hundred
      model diagnostics against what the techs actually found
- [ ] Set Stripe keys on Vercel and point the webhook at `/api/stripe/webhook`
- [ ] Create the `GCS_BUCKET` and grant the runtime service account write
      access, so inspection photos have somewhere to go
- [ ] Create the follow-up worker's Cloud Scheduler job (SETUP.md)

---

## Next — the call actually works 📞

- [ ] Realtime media service on Cloud Run: Twilio media stream ⇄ speech ⇄
      model, ending in one call to `finalizeVoiceCall`
- [ ] `<Connect><Stream>` TwiML pointed at it (`ZOL_MEDIA_STREAM_URL`)
- [ ] Business-hours routing: hand to the counter during hours, answer outside
- [ ] Caller lookup on `From` before the first word, so it opens with the truck
- [ ] Confidence floor: below it, stop talking and take a message
- [ ] Quote cap: above `auto_quote_cap_cents`, a human approves before it's said

**Done when:** a real call to a real shop's number produces a booked
appointment and a ticket with the complaint in the caller's words, with
nobody watching.

---

## Then

- [ ] Estimate texts with the shop's branding once texting is on
- [ ] Appointment reminders the evening before (the kind exists; schedule it)
- [ ] Walk-in intake so a customer at the counter can type their own details
      (the `/talk` engine on a tablet)
- [ ] Supplier lookups for parts pricing and ETAs
- [ ] A query layer with generated types, once the schema settles

---

## Later

- [ ] Holiday campaigns the owner pushes from the dashboard
- [ ] Shop management system integrations (Tekmetric, Shop-Ware, Mitchell1)
- [ ] Multi-location groups under one owner
- [ ] Spanish-language calls
- [ ] Per-shop tuning on its own historical repair orders

---

## Known risks

**Diagnosis quality is the whole product.** A confidently wrong cause quoted to
a customer costs the shop money and trust. The model ranks; the technician
verifies; only the verified cause reaches an estimate. Keep it that way.

**Carrier filtering.** Even after registration, messaging that reads like
marketing gets filtered. Keep transactional follow-ups and promotional
campaigns on separate messaging services so a promo can't poison delivery of
"your car is ready".

**Recordings are two-party-consent territory.** Several states require
disclosure before recording a call. The opening line needs to handle this per
shop, per state, before recordings are switched on.

**Vercel can't host the call.** Don't let the realtime path drift onto
serverless — it won't hold the socket.

**Portal links are bearer tokens.** Anyone with the link sees that car's
repair. They expire, they're stored hashed, and they carry no way to reach
another ticket — but a shop forwarding one to the wrong number is a real
failure mode worth a warning in the UI.
