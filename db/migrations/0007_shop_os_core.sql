-- =============================================================================
-- 0007 — the shop operating system: core tables grow up
--
-- Until now the app was the front desk's notebook: customers, a ticket with
-- lines, a day per bay. This series of migrations (0007–0012) turns it into
-- the system the shop runs on — the call that opens the job, the technician
-- it's assigned to, the diagnosis, the inspection, the estimate the customer
-- approves from their phone, the parts, the invoice, the payment, and the
-- follow-up afterwards.
--
-- Everything here is additive. Existing rows keep working; new columns carry
-- defaults that describe what those rows already were. Nothing is renamed,
-- nothing is dropped, and every CHECK that grows keeps every value it had.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- shops
-- -----------------------------------------------------------------------------

ALTER TABLE shops
  -- The public handle: /talk/<slug> is where a customer chats with the shop's
  -- receptionist from the web. Lowercase, dashes, unique across all tenants.
  ADD COLUMN IF NOT EXISTS slug                text,
  ADD COLUMN IF NOT EXISTS address             text,
  ADD COLUMN IF NOT EXISTS email               text,
  -- The number customers dial and see on the invoice. Distinct from
  -- twilio_number, which is the line ZOL answers on.
  ADD COLUMN IF NOT EXISTS public_phone        text,
  -- Same shape as ro_number_seq (0002): a per-shop counter behind a row lock,
  -- so two advisors sending estimates at once can't collide.
  ADD COLUMN IF NOT EXISTS estimate_number_seq integer NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS invoice_number_seq  integer NOT NULL DEFAULT 3000;

ALTER TABLE shops
  DROP CONSTRAINT IF EXISTS shops_public_phone_e164;
ALTER TABLE shops
  ADD CONSTRAINT shops_public_phone_e164
  CHECK (public_phone IS NULL OR public_phone ~ '^\+[1-9][0-9]{7,14}$');

/*
  Backfill a slug for every shop that exists: the name, lowercased, non-letters
  collapsed to dashes, plus the first eight characters of the id so two shops
  called "Main Street Auto" don't fight over one handle. New shops get a slug
  from sign-up, which follows the same recipe.
*/
UPDATE shops
   SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
              || '-' || left(id::text, 8)
 WHERE slug IS NULL;

/*
  A row that arrives without a slug gets one, by the same recipe. This is
  what makes the migration safe to apply ahead of the code that knows about
  slugs: in the minutes between `db:migrate` and the deploy landing, the
  running sign-up still does INSERT INTO shops (name), and that must keep
  working. It also means no future code path can strand a shop without a
  public handle.
*/
CREATE OR REPLACE FUNCTION shops_default_slug() RETURNS trigger AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := trim(both '-' from regexp_replace(lower(NEW.name), '[^a-z0-9]+', '-', 'g'))
                || '-' || left(NEW.id::text, 8);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shops_default_slug ON shops;
CREATE TRIGGER shops_default_slug BEFORE INSERT ON shops
  FOR EACH ROW EXECUTE FUNCTION shops_default_slug();

ALTER TABLE shops ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shops_slug ON shops (slug);

ALTER TABLE shops
  DROP CONSTRAINT IF EXISTS shops_slug_shape;
ALTER TABLE shops
  ADD CONSTRAINT shops_slug_shape CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- -----------------------------------------------------------------------------
-- staff — technicians have specialties, and a phone the shop can reach them on
-- -----------------------------------------------------------------------------

ALTER TABLE staff
  -- Free text, chosen by the owner: 'Diagnostics', 'Brakes', 'Electrical'.
  -- The receptionist prefers a tech whose specialty matches the complaint
  -- when it books; nothing else depends on the vocabulary.
  ADD COLUMN IF NOT EXISTS specialties text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS phone       text;

ALTER TABLE staff
  DROP CONSTRAINT IF EXISTS staff_phone_e164;
ALTER TABLE staff
  ADD CONSTRAINT staff_phone_e164
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');

-- -----------------------------------------------------------------------------
-- customers and vehicles
-- -----------------------------------------------------------------------------

ALTER TABLE customers
  -- How they'd rather hear from us. sms_opted_out still wins over everything:
  -- a preference is a preference, an opt-out is the law.
  ADD COLUMN IF NOT EXISTS preferred_contact text NOT NULL DEFAULT 'sms',
  ADD COLUMN IF NOT EXISTS address           text;

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_preferred_contact_kind;
ALTER TABLE customers
  ADD CONSTRAINT customers_preferred_contact_kind
  CHECK (preferred_contact IN ('sms', 'email', 'phone'));

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS engine text,
  ADD COLUMN IF NOT EXISTS color  text,
  ADD COLUMN IF NOT EXISTS notes  text;

-- -----------------------------------------------------------------------------
-- appointments — who's doing it, what for, and where the booking came from
-- -----------------------------------------------------------------------------

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS technician_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  -- 'Check-engine diagnostic', 'Oil service' — the receptionist's words or
  -- the advisor's. Free text on purpose; shops don't share a service menu.
  ADD COLUMN IF NOT EXISTS service_type  text,
  ADD COLUMN IF NOT EXISTS complaint     text,
  ADD COLUMN IF NOT EXISTS notes         text,
  -- Where the booking came from. booked_by_agent (already on the table) stays
  -- as the boolean the board colours by; this says which door.
  ADD COLUMN IF NOT EXISTS source        text NOT NULL DEFAULT 'counter',
  ADD COLUMN IF NOT EXISTS call_id       uuid REFERENCES calls(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at  timestamptz;

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_source_kind;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_source_kind
  CHECK (source IN ('counter', 'agent', 'web', 'call', 'portal'));

CREATE INDEX IF NOT EXISTS appointments_technician_window
  ON appointments (technician_id, starts_at)
  WHERE technician_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- repair orders — the workbench
-- -----------------------------------------------------------------------------

ALTER TABLE repair_orders
  ADD COLUMN IF NOT EXISTS technician_id  uuid REFERENCES staff(id) ON DELETE SET NULL,
  -- Check-in: what the advisor records when the keys are handed over.
  ADD COLUMN IF NOT EXISTS fuel_level     smallint,
  ADD COLUMN IF NOT EXISTS visible_damage text,
  ADD COLUMN IF NOT EXISTS check_in_notes text,
  ADD COLUMN IF NOT EXISTS checked_in_at  timestamptz,
  -- When the customer was told it would be ready.
  ADD COLUMN IF NOT EXISTS promised_at    timestamptz,
  -- When the work was finished, as distinct from closed_at (paid and gone).
  ADD COLUMN IF NOT EXISTS completed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS priority       text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS source         text NOT NULL DEFAULT 'counter';

ALTER TABLE repair_orders
  DROP CONSTRAINT IF EXISTS repair_orders_fuel_level_range;
ALTER TABLE repair_orders
  ADD CONSTRAINT repair_orders_fuel_level_range
  CHECK (fuel_level IS NULL OR fuel_level BETWEEN 0 AND 100);

ALTER TABLE repair_orders
  DROP CONSTRAINT IF EXISTS repair_orders_priority_kind;
ALTER TABLE repair_orders
  ADD CONSTRAINT repair_orders_priority_kind
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

ALTER TABLE repair_orders
  DROP CONSTRAINT IF EXISTS repair_orders_source_kind;
ALTER TABLE repair_orders
  ADD CONSTRAINT repair_orders_source_kind
  CHECK (source IN ('counter', 'agent', 'web', 'call', 'portal'));

/*
  Two new stops on the line. `diagnosing` sits between open and the estimate:
  the tech has the car and is finding out what's wrong, which is most of a
  diagnostic visit and deserves its own column. `quality_check` sits between
  the repair and ready: a second pair of eyes before the customer is called.

  The original constraint was created inline and so carries Postgres's
  generated name; it's dropped by that name and recreated with the full set.
*/
ALTER TABLE repair_orders DROP CONSTRAINT IF EXISTS repair_orders_status_check;
ALTER TABLE repair_orders
  ADD CONSTRAINT repair_orders_status_check
  CHECK (status IN ('open', 'diagnosing', 'awaiting_approval', 'awaiting_parts',
                    'in_progress', 'quality_check', 'ready', 'closed', 'cancelled'));

CREATE INDEX IF NOT EXISTS repair_orders_technician_status
  ON repair_orders (technician_id, status)
  WHERE technician_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- repair order lines — approval lives on the line
--
-- The estimate the customer sees is the ticket's lines, frozen. Their answer
-- comes back per line, and it has to land somewhere the total can read: a
-- declined line stays on the ticket as the record of what was offered, but it
-- is no longer money the shop is owed.
-- -----------------------------------------------------------------------------

ALTER TABLE repair_order_lines
  ADD COLUMN IF NOT EXISTS approval    text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE repair_order_lines
  DROP CONSTRAINT IF EXISTS repair_order_lines_approval_kind;
ALTER TABLE repair_order_lines
  ADD CONSTRAINT repair_order_lines_approval_kind
  CHECK (approval IN ('pending', 'approved', 'declined'));

/*
  Lines that exist today were typed by an advisor onto a ticket with nobody to
  ask; they are approved by definition. From here on a new line starts pending
  and becomes approved when the customer says so, or when an advisor records
  that they said so at the counter.
*/
UPDATE repair_order_lines SET approval = 'approved', approved_at = created_at
 WHERE approval = 'pending';

-- -----------------------------------------------------------------------------
-- repair order events — the ticket's history, in order
--
-- Every status change, assignment, estimate sent, part received and payment
-- taken lands here. It is what the timeline on the ticket renders and what
-- "who approved that?" is answered from. `actor` carries the page's one
-- colour system: 'zol' did it unattended, a 'person' pressed the button.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS repair_order_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  repair_order_id uuid NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  detail          text,
  from_status     text,
  to_status       text,
  actor           text NOT NULL DEFAULT 'person' CHECK (actor IN ('zol', 'person')),
  staff_id        uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS repair_order_events_ro
  ON repair_order_events (repair_order_id, created_at);

CREATE INDEX IF NOT EXISTS repair_order_events_shop_recent
  ON repair_order_events (shop_id, created_at DESC);
