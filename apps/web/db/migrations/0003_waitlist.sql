-- =============================================================================
-- 0003 — the waitlist
--
-- Everything else in this schema is tenant-scoped: a row belongs to a shop,
-- and shop_id is the first column. These rows deliberately are not. A waitlist
-- entry is a shop that does not exist here yet — there is nothing to hang it
-- off, and inventing a shops row for a lead would put fictional tenants in
-- front of every count and every join in the app. When one of these converts,
-- a real shop is created by sign-up and this row stays what it is: the record
-- of who asked and when.
--
-- The consent columns are the reason this table is worth being careful about.
-- We intend to text these people, so the row has to be able to answer "what
-- exactly did they agree to, and when" long after the page copy has changed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  full_name     text NOT NULL,
  email         text NOT NULL,
  -- E.164, same rule as every other number in this database. What the shop
  -- owner types is "(661) 555-0148"; the conversion happens at the edge.
  phone         text NOT NULL,
  shop_name     text NOT NULL,
  zip           text NOT NULL,

  -- Bands rather than an exact count: nobody knows whether the alignment rack
  -- counts, and the answer only has to be good enough to sort by.
  bays          text NOT NULL
                CHECK (bays IN ('1-3', '4-6', '7-10', '10+')),

  -- Stored as a stable key, never the display label — the wording on the page
  -- will change and these rows have to stay comparable.
  current_software text NOT NULL
                CHECK (current_software IN (
                  'tekmetric', 'shopmonkey', 'shop-ware', 'mitchell1',
                  'autoleap', 'other', 'paper'
                )),

  /*
    Sorting by band is the whole point of collecting it — work the biggest
    shops first. Plain text sorts '10+' below '1-3', so the ordinal is derived
    here rather than left to every query to get right, and generated rather
    than stored twice so it cannot drift from `bays`.
  */
  bays_min      smallint GENERATED ALWAYS AS (
                  CASE bays
                    WHEN '1-3'  THEN 1
                    WHEN '4-6'  THEN 4
                    WHEN '7-10' THEN 7
                    WHEN '10+'  THEN 10
                  END
                ) STORED,

  -- Not nullable and constrained true: a row exists here only if somebody
  -- ticked the box. There is no such thing as a waitlist entry that did not
  -- consent, and a nullable boolean would eventually be read as "probably".
  consent       boolean NOT NULL,
  consent_at    timestamptz NOT NULL DEFAULT now(),

  -- Where it came from, for attribution. All nullable: most arrivals are
  -- somebody typing the domain in.
  source_page   text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_term      text,
  utm_content   text,

  ip            text,
  user_agent    text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT waitlist_entries_phone_e164
    CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT waitlist_entries_zip_5
    CHECK (zip ~ '^[0-9]{5}$'),
  CONSTRAINT waitlist_entries_consented
    CHECK (consent)
);

-- One address is one entry. Lower()'d for the same reason staff_email_lower
-- is: people capitalise their own email inconsistently, and Zaz@ and zaz@ are
-- the same shop owner filling the form in twice.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_email_lower
  ON waitlist_entries (lower(email));

-- The list is worked biggest-shop-first.
CREATE INDEX IF NOT EXISTS waitlist_entries_bays_created
  ON waitlist_entries (bays_min DESC, created_at DESC);

-- -----------------------------------------------------------------------------
-- Submission attempts, for the per-IP limit
--
-- Same shape and the same reasoning as auth_attempts: serverless hands every
-- request a different instance, so an in-process counter counts nothing. One
-- row per submission, counted over a window, pruned by the query that reads it.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS waitlist_attempts (
  id bigserial PRIMARY KEY,
  ip text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waitlist_attempts_ip_at ON waitlist_attempts (ip, at DESC);
CREATE INDEX IF NOT EXISTS waitlist_attempts_at ON waitlist_attempts (at);
