-- =============================================================================
-- 0016 — SMS consent for ZOL's own support line
--
-- ZOL INC texts its *own* business customers — shop owners and staff — for
-- support replies, onboarding help, service notices and billing notices.
-- This is a separate program from a shop texting its vehicle owners (that is
-- `customers.sms_opted_out`, per shop), and it is registered with the
-- carriers under ZOL's own brand. The two must never share a table: a STOP
-- to ZOL support is not a STOP to the shop that person's car is at.
--
-- Append-only. Every consent event is a row — the web form, a verbal yes on
-- an onboarding call, START or STOP by text — and the current state of a
-- number is its latest row. Nothing is updated in place, so "what exactly did
-- they agree to, and when, and from where" is answerable long after the page
-- copy has changed: the row carries the consent text it was given, verbatim,
-- and the version label that text was published under.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sms_consent_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- E.164, same rule as every other number in this database.
  phone         text NOT NULL
                CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),

  event         text NOT NULL
                CHECK (event IN ('opt_in', 'opt_out')),

  -- Where the consent (or the withdrawal) came from. 'web' is the form on
  -- /sms-opt-in, 'call' is the verbal script on an onboarding call entered
  -- by ZOL staff, 'sms' is a START or STOP keyword received on the support
  -- line.
  channel       text NOT NULL
                CHECK (channel IN ('web', 'call', 'sms')),

  -- Who said yes. Null for a keyword received by text, where all we hold is
  -- the number.
  full_name     text,
  shop_name     text,

  -- The exact words shown or read, and the label they were published under.
  -- Both stored, because the version alone means nothing once the text in the
  -- code has moved on.
  consent_text_version text NOT NULL,
  consent_text         text NOT NULL,

  -- Request provenance for a web submission; null for the other channels.
  ip            text,
  user_agent    text,

  at            timestamptz NOT NULL DEFAULT now()
);

-- "Current state of this number" is the newest row for it.
CREATE INDEX IF NOT EXISTS sms_consent_events_phone_at_idx
  ON sms_consent_events (phone, at DESC);

-- Per-IP ceiling for the public form, pruned by the action that reads it —
-- the same arrangement as waitlist_attempts, for the same reason.
CREATE TABLE IF NOT EXISTS sms_consent_attempts (
  ip  text NOT NULL,
  at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_consent_attempts_ip_at_idx
  ON sms_consent_attempts (ip, at);
