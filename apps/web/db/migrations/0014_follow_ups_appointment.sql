-- =============================================================================
-- 0014 — a follow-up knows which appointment it is about
--
-- The confirmation and the reminder are queued for one appointment, but the
-- row only carried the customer and, when there was one, the vehicle. So
-- cancelling a visit swept every pending confirmation for that customer and
-- car — including the one for the visit they are still coming to. The link
-- makes the sweep exact: cancel this appointment, cancel this appointment's
-- messages, nothing else.
--
-- ON DELETE SET NULL, not CASCADE: an appointment row going away must not
-- take the record of what was said to the customer with it. Rows queued
-- before this migration have no link and are left alone by the new sweep;
-- they drain within one worker pass anyway.
-- =============================================================================

ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS follow_ups_appointment
  ON follow_ups (appointment_id)
  WHERE appointment_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- conversations — the public chat's per-connection ceiling
-- -----------------------------------------------------------------------------

/*
  /api/receptionist caps new conversations per connecting IP across every
  shop, not per shop — one host must not get a fresh twenty at each slug.
  The count is `WHERE ip = $1 AND created_at > now() - '1 hour'`, which the
  (shop_id, created_at) index from 0012 no longer serves.
*/
CREATE INDEX IF NOT EXISTS conversations_ip_recent
  ON conversations (ip, created_at DESC)
  WHERE ip IS NOT NULL;
