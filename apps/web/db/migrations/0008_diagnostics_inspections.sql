-- =============================================================================
-- 0008 — what the technician found
--
-- Two records per visit, kept apart because they answer different questions.
-- A diagnostic is "why is it doing that": codes, symptoms, the model's ranked
-- causes and the tech's verdict. An inspection is "what shape is the rest of
-- it in": thirteen systems, each green, yellow, red or not looked at. The
-- estimate draws on both; the customer portal shows both.
-- =============================================================================

CREATE TABLE IF NOT EXISTS diagnostics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  repair_order_id uuid NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  vehicle_id      uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  technician_id   uuid REFERENCES staff(id) ON DELETE SET NULL,
  -- 'P0301', 'P0171' — uppercased on the way in.
  obd_codes       text[] NOT NULL DEFAULT '{}',
  symptoms        text,
  observations    text,
  /*
    What the model returned, verbatim, so a later and better model can be
    re-run against the same inputs without losing what this one said. The
    shape is validated on the way in (lib/ai/diagnostics.ts) — this column is
    storage, not a contract.
  */
  ai_result       jsonb,
  ai_source       text NOT NULL DEFAULT 'fallback'
                  CHECK (ai_source IN ('openai', 'fallback')),
  -- The technician's own conclusion. The model ranks causes; a person
  -- confirms one, and that is the only thing that turns into an estimate.
  verification    text,
  verified_by     uuid REFERENCES staff(id) ON DELETE SET NULL,
  verified_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS diagnostics_ro ON diagnostics (repair_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS diagnostics_vehicle ON diagnostics (vehicle_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inspections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  repair_order_id uuid NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  vehicle_id      uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  technician_id   uuid REFERENCES staff(id) ON DELETE SET NULL,
  title           text NOT NULL DEFAULT 'Digital vehicle inspection',
  -- The worst rating on any item, once completed.
  overall         text NOT NULL DEFAULT 'not_inspected'
                  CHECK (overall IN ('green', 'yellow', 'red', 'not_inspected')),
  -- Customer-facing summary: { summary, urgent[], recommended[], maintenance[],
  -- safety[] }. Built only from items that were actually rated.
  summary         jsonb,
  summary_source  text CHECK (summary_source IN ('openai', 'fallback')),
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inspections_ro ON inspections (repair_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inspections_shop_recent ON inspections (shop_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS inspection_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  category      text NOT NULL,
  name          text NOT NULL,
  rating        text NOT NULL DEFAULT 'not_inspected'
                CHECK (rating IN ('green', 'yellow', 'red', 'not_inspected')),
  notes         text,
  -- '4mm', '26.1 mm', '12.4V' — free text, because the unit depends on the
  -- item and a number without its unit is worse than the string.
  measurement   text,
  position      smallint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inspection_items_inspection
  ON inspection_items (inspection_id, position);

-- -----------------------------------------------------------------------------
-- attachments — photos and documents, hung off whatever they describe
--
-- One table rather than a photos column on four tables. The bytes live in
-- object storage (lib/storage/provider.ts); this row is the pointer plus the
-- caption. entity_type/entity_id is a soft reference on purpose: a photo of a
-- worn rotor is worth keeping even if the inspection item that mentioned it
-- is later reorganised.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  kind         text NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo', 'document')),
  entity_type  text NOT NULL
               CHECK (entity_type IN ('repair_order', 'inspection', 'inspection_item',
                                      'vehicle', 'diagnostic')),
  entity_id    uuid NOT NULL,
  -- Where the provider put it, and a URL a browser can load.
  storage_key  text NOT NULL,
  url          text NOT NULL,
  content_type text,
  size_bytes   integer,
  caption      text,
  created_by   uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attachments_entity ON attachments (entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS attachments_shop ON attachments (shop_id, created_at DESC);

-- updated_at maintenance for the new tables that carry it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['diagnostics', 'inspections', 'inspection_items'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = t || '_touch'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I_touch BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
    END IF;
  END LOOP;
END $$;
