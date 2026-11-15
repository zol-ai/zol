-- =============================================================================
-- 0006 — keyset pagination over the waitlist
--
-- `GET /api/waitlist/entries` is a read-only window onto this table for
-- Company OS to reconcile against. Nothing is copied that the push path was
-- not already copying; the endpoint exists so the two sides can be compared
-- without a second store of the same rows.
--
-- Keyset rather than OFFSET, on (updated_at, event_id). OFFSET re-scans
-- everything it skips, which gets slower with every page, and it silently
-- drops rows when the underlying set shifts mid-walk — which this set does,
-- because a resubmission moves a row's updated_at while a reconciliation is
-- running.
--
-- event_id breaks ties. updated_at alone is not unique: two submissions in the
-- same microsecond would make the cursor ambiguous, and a page boundary
-- landing between them would skip one for good.
--
-- Ordered ascending, which is what makes the walk safe. A row whose updated_at
-- moves forward mid-walk moves *behind* the cursor and is visited again — a
-- duplicate, which the receiver discards. updated_at never decreases, so
-- nothing can move ahead of the cursor and be missed. At-least-once, never
-- at-most-once, which is the correct bias for a reconciliation.
-- =============================================================================

CREATE INDEX IF NOT EXISTS waitlist_entries_updated_event
  ON waitlist_entries (updated_at, event_id);
