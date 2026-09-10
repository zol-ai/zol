-- =============================================================================
-- 0011 — talking to the customer, and to the shop
--
-- Three tables with three audiences, kept apart on purpose:
--
--   messages       — what was actually said to or by a customer, on whatever
--                    channel. The conversation history. Append-only.
--   follow_ups     — what ZOL intends to say and when. The outbound queue, and
--                    now also the CRM's worklist: a follow-up can be drafted,
--                    sent by the worker, or closed by a person who phoned.
--   notifications  — the bell in the corner for staff. Nothing a customer sees.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------

/*
  Two new channels and a third direction.

  'portal' is a message the customer reads on their repair page rather than
  receiving as a text. It is what every customer-facing update becomes while
  telephony is switched off (carrier registration pending), and what it also
  becomes once it's on — the text is a copy of the portal message, not a
  different thing. 'note' is internal: a tech writing "customer says it only
  does it cold" for the advisor, never sent anywhere.
*/
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('sms', 'email', 'portal', 'note'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_direction_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_direction_check
  CHECK (direction IN ('inbound', 'outbound', 'internal'));

ALTER TABLE messages
  -- Who wrote it, when a person did. NULL with sent_by_agent = true is ZOL.
  ADD COLUMN IF NOT EXISTS staff_id     uuid REFERENCES staff(id) ON DELETE SET NULL,
  -- The follow-up that produced it, so the CRM can show "sent, and here's
  -- what went out" without a text search.
  ADD COLUMN IF NOT EXISTS follow_up_id uuid,
  ADD COLUMN IF NOT EXISTS read_at      timestamptz;

CREATE INDEX IF NOT EXISTS messages_ro ON messages (repair_order_id, created_at)
  WHERE repair_order_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- notifications — staff-facing
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  -- NULL means everyone at the shop sees it. Set it to address one person —
  -- "your ticket was approved".
  staff_id   uuid REFERENCES staff(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text,
  -- Where clicking it goes. Relative path inside the app.
  href       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_shop_recent
  ON notifications (shop_id, created_at DESC);

-- The bell count: unread, per shop. Partial so it stays tiny.
CREATE INDEX IF NOT EXISTS notifications_unread
  ON notifications (shop_id, staff_id)
  WHERE read_at IS NULL;

-- -----------------------------------------------------------------------------
-- follow_ups — the queue grows into the CRM
-- -----------------------------------------------------------------------------

/*
  More kinds: one per stop on the customer's journey through the shop, plus
  the retention ones. The original set is kept verbatim.
*/
ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_kind_check;
ALTER TABLE follow_ups
  ADD CONSTRAINT follow_ups_kind_check
  CHECK (kind IN (
    -- original
    'part_ordered', 'in_progress', 'diagnosis_ready', 'ready_for_pickup',
    'declined_work_recall', 'service_due', 'birthday', 'holiday', 'custom',
    -- the journey
    'appointment_confirmed', 'appointment_reminder', 'checked_in',
    'estimate_ready', 'approved', 'parts_received', 'payment_receipt',
    -- retention
    'post_repair', 'win_back', 'inspection_recommendation'
  ));

/*
  'done' is new: a person closed it without a message going out — they rang
  the customer, or raised it at the counter. Distinct from 'cancelled' (we
  decided not to) and 'sent' (the worker sent it).
*/
ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_status_check;
ALTER TABLE follow_ups
  ADD CONSTRAINT follow_ups_status_check
  CHECK (status IN ('pending', 'sent', 'done', 'cancelled', 'failed'));

ALTER TABLE follow_ups
  -- What the CRM card says. body stays what the customer receives.
  ADD COLUMN IF NOT EXISTS title            text,
  ADD COLUMN IF NOT EXISTS details          text,
  -- A draft the model wrote from verified facts, for a person to send or edit.
  -- Never sent on its own: the worker sends `body`, and a person copies the
  -- draft into it when they're happy with it.
  ADD COLUMN IF NOT EXISTS ai_draft         text,
  ADD COLUMN IF NOT EXISTS vehicle_id       uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS declined_work_id uuid REFERENCES declined_work(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS channel          text NOT NULL DEFAULT 'sms',
  ADD COLUMN IF NOT EXISTS completed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by     uuid REFERENCES staff(id) ON DELETE SET NULL,
  -- Who queued it. 'zol' for the journey messages, 'person' for a manual one.
  ADD COLUMN IF NOT EXISTS source           text NOT NULL DEFAULT 'zol',
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();

ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_channel_kind;
ALTER TABLE follow_ups
  ADD CONSTRAINT follow_ups_channel_kind CHECK (channel IN ('sms', 'email', 'portal'));

ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_source_kind;
ALTER TABLE follow_ups
  ADD CONSTRAINT follow_ups_source_kind CHECK (source IN ('zol', 'person'));

-- The CRM's view: everything open for a shop, soonest first.
CREATE INDEX IF NOT EXISTS follow_ups_shop_open
  ON follow_ups (shop_id, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS follow_ups_customer
  ON follow_ups (customer_id, created_at DESC);

-- Now that follow_ups is stable, close the loop from messages.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_follow_up_fk;
ALTER TABLE messages
  ADD CONSTRAINT messages_follow_up_fk
  FOREIGN KEY (follow_up_id) REFERENCES follow_ups(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'follow_ups_touch') THEN
    CREATE TRIGGER follow_ups_touch BEFORE UPDATE ON follow_ups
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;
