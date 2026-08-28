-- =============================================================================
-- 0005 — waitlist delivery to Company OS
--
-- The site does not call Company OS from the submission path. It writes here,
-- returns, and a scheduled sweeper drains what hasn't been delivered. That
-- makes this table the queue, so it needs the three columns a queue needs:
-- what to deliver, which version of it, and whether it's gone yet.
--
-- The split between event_id and revision is the whole point. waitlist_entries
-- deduplicates on lower(email) and the action upserts, so a row is *mutable* —
-- somebody who resubmits with a corrected phone number updates the row they
-- already own. A single stable ID cannot also be the deduplication key: the
-- corrected submission would arrive carrying an ID the receiver had already
-- seen, be treated as a duplicate, and be dropped without anything looking
-- broken. So event_id names the person and revision names the version, and the
-- receiver deduplicates on the pair.
-- =============================================================================

-- Names the row, and therefore the person. Generated once and never reissued —
-- the receiver uses it for lineage, to say which submission a contact came
-- from. gen_random_uuid() is volatile, so the backfill gives every existing row
-- its own value rather than one shared default.
ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS event_id uuid NOT NULL DEFAULT gen_random_uuid();

-- Names the version of the row. Bumped by the upsert only when a field the
-- receiver actually cares about changed; a resubmission with identical answers
-- leaves this alone and therefore never redelivers.
ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

-- Null means "not yet accepted by Company OS". The sweeper's whole query is
-- this column.
ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

/*
  Every number this row has ever had, oldest first, excluding the current one.

  Phone is the match key on the receiving side, which makes a corrected number
  the one edit that can't be merged: the new number matches nothing, so the
  event creates a second client and the original keeps the stale value. Sending
  the history lets the receiver fall back to "have I seen any of these before",
  find the existing record, and correct it in place.

  CHECK on the joined string rather than per element, because a CHECK
  constraint is a single expression and cannot contain a subquery. Empty array
  joins to the empty string, which the pattern accepts.
*/
ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS phone_history text[] NOT NULL DEFAULT '{}';

ALTER TABLE waitlist_entries
  DROP CONSTRAINT IF EXISTS waitlist_entries_phone_history_e164;

ALTER TABLE waitlist_entries
  ADD CONSTRAINT waitlist_entries_phone_history_e164
  CHECK (array_to_string(phone_history, ',') ~ '^(\+[1-9][0-9]{7,14}(,|$))*$');

/*
  Everything that already exists is marked delivered.

  Not because it is old enough for the sweeper's seven-day window to skip it —
  that window is a safety net against retrying a permanently failing row
  forever, and leaning on it here would mean nobody could ever tell whether a
  given row was excluded on purpose or fell through a gap. Historical entries
  are out of scope for this integration. If they should end up in Company OS
  that is a separate script, run deliberately and watched.

  Guarded on IS NULL so re-running the migration cannot restamp a row the
  sweeper legitimately delivered later.
*/
UPDATE waitlist_entries SET delivered_at = now() WHERE delivered_at IS NULL;

-- One row, one event_id. The receiver treats it as an identity.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_event_id
  ON waitlist_entries (event_id);

/*
  The sweeper's index, and only the sweeper's.

  Partial on the null check, because the interesting set is the tiny one:
  everything delivered is dead weight in an index that exists to answer "what
  is still outstanding". Ordered by created_at so the oldest undelivered row
  goes first — a backlog should drain in the order it arrived.
*/
CREATE INDEX IF NOT EXISTS waitlist_entries_undelivered
  ON waitlist_entries (created_at)
  WHERE delivered_at IS NULL;
