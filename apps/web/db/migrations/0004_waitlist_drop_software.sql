-- =============================================================================
-- 0004 — drop the software question from the waitlist form
--
-- The page promises "six boxes"; asking what the shop runs today made seven.
-- The column stays — dropping it would lose whatever's already been answered
-- — but new rows no longer have to answer it.
-- =============================================================================

ALTER TABLE waitlist_entries ALTER COLUMN current_software DROP NOT NULL;
