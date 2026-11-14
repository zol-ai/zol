-- =============================================================================
-- 0012 — the receptionist's memory
--
-- A conversation is one exchange between a customer and ZOL, on whatever
-- channel: a phone call (transcribed), a web chat from /talk/<slug>, or a
-- text thread. The messages inside it are the transcript. `intake` is what
-- ZOL extracted from it — customer, vehicle, complaint, urgency, preferred
-- time — and is the thing that gets turned into an appointment.
--
-- calls already existed (0000 baseline) as the telephony record: SIDs,
-- numbers, duration, recording. It stays that, and gains the pointers that
-- connect it to the conversation, the customer, the vehicle and the booking.
-- The web receptionist writes a conversation and no call; the phone writes
-- both. When the Twilio voice path lands, it fills the same rows.
-- =============================================================================

CREATE TABLE IF NOT EXISTS conversations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  -- NULL until the caller is identified. A web chat starts anonymous.
  customer_id    uuid REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id     uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  channel        text NOT NULL CHECK (channel IN ('voice', 'web', 'sms')),
  -- The number the person is on, when known. E.164 like everything else.
  phone          text,
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'booked', 'completed', 'escalated', 'abandoned')),
  -- { customerName, phone, vehicle: {year, make, model}, complaint, symptoms[],
  --   urgency, serviceType, preferredTime, summary, safetyAdvice }
  intake         jsonb,
  intake_source  text CHECK (intake_source IN ('openai', 'fallback')),
  summary        text,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  -- Where the request came from, for the per-IP ceiling on the public chat.
  ip             text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_phone_e164
    CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE INDEX IF NOT EXISTS conversations_shop_recent ON conversations (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS conversations_customer ON conversations (customer_id, created_at DESC);
-- An open SMS thread is found by (shop, phone): the next inbound text joins it.
CREATE INDEX IF NOT EXISTS conversations_open_phone
  ON conversations (shop_id, phone)
  WHERE status = 'open' AND phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('assistant', 'customer', 'system')),
  content         text NOT NULL,
  -- Anything structured the model returned alongside the reply: intent,
  -- missing fields, whether it was ready to book. Kept for the call review
  -- screen and for tuning; nothing reads it for business logic.
  structured      jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_messages_conversation
  ON conversation_messages (conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- calls
-- -----------------------------------------------------------------------------

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS status              text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS caller_name         text,
  ADD COLUMN IF NOT EXISTS summary             text,
  -- A copy of the conversation's intake at the time the call closed.
  ADD COLUMN IF NOT EXISTS intake              jsonb,
  ADD COLUMN IF NOT EXISTS vehicle_id          uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_id      uuid REFERENCES appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id     uuid REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sentiment           text,
  ADD COLUMN IF NOT EXISTS escalation_required boolean NOT NULL DEFAULT false,
  /*
    True for a call that never touched a phone line: the "run a test call"
    button on the calls screen, which pushes a scripted transcript through
    exactly the pipeline a real one will use. Labelled on every screen, and
    excluded from the shop's answer-rate numbers.
  */
  ADD COLUMN IF NOT EXISTS simulated           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handled_by          text NOT NULL DEFAULT 'zol';

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_status_kind;
ALTER TABLE calls
  ADD CONSTRAINT calls_status_kind
  CHECK (status IN ('ringing', 'in_progress', 'processing', 'completed', 'escalated', 'missed'));

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_handled_by_kind;
ALTER TABLE calls
  ADD CONSTRAINT calls_handled_by_kind CHECK (handled_by IN ('zol', 'person'));

/*
  Outcomes, extended. The original five described what happened to the *line*
  (handled, routed to a person, voicemail, abandoned, failed). The new ones
  describe what ZOL *did* when it handled it. Both vocabularies stay valid.
*/
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_outcome_check;
ALTER TABLE calls
  ADD CONSTRAINT calls_outcome_check
  CHECK (outcome IS NULL OR outcome IN (
    'handled', 'routed', 'voicemail', 'abandoned', 'failed',
    'booked', 'status_provided', 'question_answered', 'escalated', 'no_action'
  ));

CREATE INDEX IF NOT EXISTS calls_appointment ON calls (appointment_id) WHERE appointment_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'conversations_touch') THEN
    CREATE TRIGGER conversations_touch BEFORE UPDATE ON conversations
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;
