-- =============================================================================
-- 0010 — the money at the end
--
-- An invoice is the ticket's approved lines, frozen a second time, at the
-- moment the work is done. Payments are rows against it — one, or several,
-- because a customer who pays half by card and half in cash is a Tuesday.
-- ZOL never holds card numbers: a Stripe payment stores Stripe's reference and
-- nothing else, and the demo provider (no Stripe keys configured) is labelled
-- as such on every screen it touches.
--
-- Portal tokens are how a customer with no account reaches their own repair:
-- one opaque link per repair order, texted to them, stored only as a hash.
-- =============================================================================

CREATE TABLE IF NOT EXISTS invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  -- One invoice per ticket. A second one is a new ticket.
  repair_order_id uuid NOT NULL UNIQUE REFERENCES repair_orders(id) ON DELETE RESTRICT,
  estimate_id     uuid REFERENCES estimates(id) ON DELETE SET NULL,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  vehicle_id      uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  number          integer NOT NULL,
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('draft', 'open', 'partial', 'paid', 'void')),
  subtotal_cents  integer NOT NULL DEFAULT 0,
  tax_cents       integer NOT NULL DEFAULT 0,
  total_cents     integer NOT NULL DEFAULT 0,
  -- Sum of succeeded payments. Stored so the list can show a balance without
  -- summing payments for every row; every payment write recomputes it.
  paid_cents      integer NOT NULL DEFAULT 0,
  due_at          timestamptz,
  paid_at         timestamptz,
  created_by      uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);

CREATE INDEX IF NOT EXISTS invoices_shop_status ON invoices (shop_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_customer ON invoices (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('labor', 'part', 'fee', 'discount')),
  description text NOT NULL,
  quantity    numeric(8,2) NOT NULL DEFAULT 1,
  unit_cents  integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  position    smallint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS invoice_lines_invoice ON invoice_lines (invoice_id, position);

CREATE TABLE IF NOT EXISTS payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  method       text NOT NULL DEFAULT 'card'
               CHECK (method IN ('card', 'cash', 'check', 'other')),
  -- 'stripe' carries a real charge, 'manual' is a person recording cash or a
  -- cheque at the counter, 'demo' is the labelled stand-in used when no
  -- payment processor is configured.
  provider     text NOT NULL CHECK (provider IN ('stripe', 'manual', 'demo')),
  -- Stripe's payment intent / checkout session id. Never a card number.
  provider_ref text,
  status       text NOT NULL DEFAULT 'succeeded'
               CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  note         text,
  recorded_by  uuid REFERENCES staff(id) ON DELETE SET NULL,
  processed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_invoice ON payments (invoice_id, created_at);
CREATE INDEX IF NOT EXISTS payments_shop_recent ON payments (shop_id, created_at DESC);

-- A Stripe webhook can arrive twice. One row per provider reference.
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref
  ON payments (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

-- -----------------------------------------------------------------------------
-- portal tokens
--
-- Same storage rule as sessions and invites: the link carries the token, the
-- table holds its SHA-256. A dump of this table opens nobody's repair.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS portal_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  repair_order_id uuid NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  last_viewed_at  timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_tokens_ro ON portal_tokens (repair_order_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'invoices_touch') THEN
    CREATE TRIGGER invoices_touch BEFORE UPDATE ON invoices
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;
