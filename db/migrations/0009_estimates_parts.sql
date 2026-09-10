-- =============================================================================
-- 0009 — the estimate and the parts
--
-- The ticket's lines are the live work. An estimate is a *sent copy* of them:
-- what the customer was shown, at what price, and what they said to each
-- line. Freezing it matters because the advisor keeps editing the ticket
-- after it goes out, and "you approved $742.18" has to be provable against
-- the page they actually saw. The answer flows back onto the ticket's lines
-- through estimate_lines.repair_order_line_id.
--
-- Parts are their own rows, not just a kind of line: a line is money, a part
-- is a thing with a supplier and an ETA that can hold a bay hostage.
-- =============================================================================

CREATE TABLE IF NOT EXISTS estimates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  repair_order_id uuid NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  vehicle_id      uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  -- Human-facing, per shop, from shops.estimate_number_seq.
  number          integer NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'viewed', 'approved',
                                    'partial', 'declined', 'expired')),
  subtotal_cents  integer NOT NULL DEFAULT 0,
  tax_cents       integer NOT NULL DEFAULT 0,
  total_cents     integer NOT NULL DEFAULT 0,
  -- The plain-English explanation the customer reads above the lines. AI may
  -- draft it from the diagnosis and inspection; the advisor can edit it.
  note            text,
  sent_at         timestamptz,
  viewed_at       timestamptz,
  responded_at    timestamptz,
  expires_at      timestamptz,
  created_by      uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);

CREATE INDEX IF NOT EXISTS estimates_ro ON estimates (repair_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS estimates_shop_status ON estimates (shop_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS estimate_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id          uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  -- The ticket line this was copied from, so the answer can be written back.
  -- SET NULL: deleting the line off the ticket later doesn't erase what the
  -- customer was shown.
  repair_order_line_id uuid REFERENCES repair_order_lines(id) ON DELETE SET NULL,
  kind                 text NOT NULL CHECK (kind IN ('labor', 'part', 'fee', 'discount')),
  description          text NOT NULL,
  quantity             numeric(8,2) NOT NULL DEFAULT 1,
  unit_cents           integer NOT NULL DEFAULT 0,
  total_cents          integer NOT NULL DEFAULT 0,
  approval             text NOT NULL DEFAULT 'pending'
                       CHECK (approval IN ('pending', 'approved', 'declined')),
  position             smallint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS estimate_lines_estimate ON estimate_lines (estimate_id, position);

CREATE TABLE IF NOT EXISTS parts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  repair_order_id      uuid NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  -- The part line on the ticket this physical part fulfils, when there is one.
  repair_order_line_id uuid REFERENCES repair_order_lines(id) ON DELETE SET NULL,
  name                 text NOT NULL,
  part_number          text,
  supplier             text,
  quantity             integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  -- What the shop pays and what the customer pays. Both cents, both stored,
  -- because the margin at the time of the order is the number that matters
  -- when somebody asks why the job made no money.
  unit_cost_cents      integer NOT NULL DEFAULT 0,
  unit_price_cents     integer NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'needed'
                       CHECK (status IN ('needed', 'requested', 'ordered',
                                         'received', 'installed', 'returned')),
  ordered_at           timestamptz,
  -- The vendor's promise. When it moves, the bay that was waiting on it moves
  -- too — this is the column the parts-delay warning reads.
  expected_at          timestamptz,
  received_at          timestamptz,
  installed_at         timestamptz,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parts_ro ON parts (repair_order_id, created_at);
CREATE INDEX IF NOT EXISTS parts_shop_status ON parts (shop_id, status, expected_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['estimates', 'parts'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_touch') THEN
      EXECUTE format(
        'CREATE TRIGGER %I_touch BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
    END IF;
  END LOOP;
END $$;
