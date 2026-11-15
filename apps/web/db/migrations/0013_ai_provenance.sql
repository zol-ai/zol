-- =============================================================================
-- 0013 — where a piece of writing came from
--
-- Two places store text a model may have drafted: the customer-facing note on
-- an estimate, and the draft on a CRM follow-up. Both fall back to a template
-- when there is no key or the call fails, and the screens label which it was.
-- Until now that label was inferred from "is a key configured right now",
-- which is wrong in exactly the case that matters — a key is set, the call
-- failed, the template was stored, and the card still says the model wrote
-- it. The diagnostic and inspection tables already carry `ai_source`; these
-- two catch up.
--
-- Nullable: a note an advisor typed themselves, or a draft that predates this
-- migration, has no source to record.
-- =============================================================================

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS note_source text
  CHECK (note_source IS NULL OR note_source IN ('openai', 'fallback', 'person'));

ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS ai_source text
  CHECK (ai_source IS NULL OR ai_source IN ('openai', 'fallback'));
