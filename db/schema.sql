-- =============================================================================
-- ZOL — core schema (PostgreSQL 15+)
--
-- Multi-tenant from the first migration. Retrofitting shop_id onto a schema
-- that assumed one shop is the kind of rewrite that eats a quarter, and the
-- whole product is "sell this to many shops".
--
-- Conventions
--   * Every tenant-scoped table carries shop_id and cascades from shops.
--   * Phone numbers are E.164 (+14155550148). Never store what the caller ID
--     happened to render.
--   * Money is integer cents. Never float.
--   * Timestamps are timestamptz. Shops span time zones; wall-clock booking is
--     rendered from shops.timezone at the edge.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- fuzzy customer/vehicle search
-- Lets a GiST exclusion constraint mix plain equality (shop_id, bay) with a
-- range overlap. The no-double-booking constraint below does not build
-- without it.
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- -----------------------------------------------------------------------------
-- Tenancy
-- -----------------------------------------------------------------------------

CREATE TABLE shops (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  timezone            text        NOT NULL DEFAULT 'America/Los_Angeles',
  -- What ZOL quotes with. Nothing goes to a customer at a rate the shop
  -- didn't set here.
  labor_rate_cents    integer     NOT NULL DEFAULT 14500,
  parts_margin_pct    numeric(5,2) NOT NULL DEFAULT 35.00,
  tax_rate_pct        numeric(5,2) NOT NULL DEFAULT 0.00,
  bay_count           smallint    NOT NULL DEFAULT 2,
  -- Ceiling on what the agent may quote without a human approving it.
  auto_quote_cap_cents integer    NOT NULL DEFAULT 100000,
  twilio_number       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shops_twilio_number_e164
    CHECK (twilio_number IS NULL OR twilio_number ~ '^\+[1-9][0-9]{7,14}$')
);

-- Opening hours drive both call routing (route to the counter during hours,
-- answer directly outside them) and what slots the agent may offer.
CREATE TABLE shop_hours (
  shop_id     uuid     NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  -- 0 = Sunday, matching EXTRACT(DOW).
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at    time,
  closes_at   time,
  is_closed   boolean  NOT NULL DEFAULT false,
  PRIMARY KEY (shop_id, day_of_week),
  CONSTRAINT shop_hours_range
    CHECK (is_closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at < closes_at))
);

CREATE TABLE staff (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  email      text NOT NULL,
  full_name  text NOT NULL,
  role       text NOT NULL DEFAULT 'advisor'
             CHECK (role IN ('owner', 'advisor', 'tech')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, email)
);

-- -----------------------------------------------------------------------------
-- Customers and vehicles
-- -----------------------------------------------------------------------------

CREATE TABLE customers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  phone          text NOT NULL,
  full_name      text,
  email          text,
  -- Powers the birthday / anniversary follow-ups. Nullable: most callers
  -- never volunteer it and we must not invent one.
  birthday       date,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  -- Carrier compliance. Once false, nothing outbound may be queued, ever.
  sms_opted_out  boolean NOT NULL DEFAULT false,
  sms_opted_out_at timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- The phone number is the identity: it's what we have when the phone rings.
  UNIQUE (shop_id, phone),
  CONSTRAINT customers_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE INDEX customers_name_trgm ON customers USING gin (full_name gin_trgm_ops);

CREATE TABLE vehicles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  year        smallint,
  make        text,
  model       text,
  trim        text,
  vin         text,
  plate       text,
  mileage     integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_vin_len CHECK (vin IS NULL OR char_length(vin) = 17)
);

CREATE INDEX vehicles_customer ON vehicles (customer_id);
CREATE UNIQUE INDEX vehicles_shop_vin ON vehicles (shop_id, vin) WHERE vin IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Calls
-- -----------------------------------------------------------------------------

CREATE TABLE calls (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id    uuid REFERENCES customers(id) ON DELETE SET NULL,
  twilio_call_sid text UNIQUE,
  direction      text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number    text NOT NULL,
  to_number      text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  duration_seconds integer,
  -- 'handled' = ZOL took it end to end; 'routed' = passed to a human.
  outcome        text CHECK (outcome IN ('handled', 'routed', 'voicemail', 'abandoned', 'failed')),
  recording_url  text,
  transcript     jsonb,
  -- What the model concluded, kept separate from the transcript so we can
  -- re-run diagnosis against a better model without losing the original.
  diagnosis      jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calls_shop_started ON calls (shop_id, started_at DESC);
CREATE INDEX calls_customer ON calls (customer_id, started_at DESC);

-- -----------------------------------------------------------------------------
-- Repair orders
-- -----------------------------------------------------------------------------

CREATE TABLE repair_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  -- Human-facing ticket number, per shop. The number on the paper.
  number        integer NOT NULL,
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  vehicle_id    uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  opened_by_call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'awaiting_approval', 'awaiting_parts',
                                  'in_progress', 'ready', 'closed', 'cancelled')),
  -- The three C's every shop writes on the ticket.
  complaint     text,
  cause         text,
  correction    text,
  mileage_in    integer,
  total_cents   integer NOT NULL DEFAULT 0,
  -- Set when a human signs off on a quote above auto_quote_cap_cents.
  approved_at   timestamptz,
  approved_by   uuid REFERENCES staff(id) ON DELETE SET NULL,
  closed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, number)
);

CREATE INDEX repair_orders_shop_status ON repair_orders (shop_id, status);
CREATE INDEX repair_orders_customer ON repair_orders (customer_id, created_at DESC);

CREATE TABLE repair_order_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id uuid NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('labor', 'part', 'fee', 'discount')),
  description     text NOT NULL,
  -- Book hours for labor lines, unit count for parts.
  quantity        numeric(8,2) NOT NULL DEFAULT 1,
  unit_cents      integer NOT NULL DEFAULT 0,
  total_cents     integer NOT NULL DEFAULT 0,
  -- True when ZOL priced this line itself rather than a human entering it.
  quoted_by_agent boolean NOT NULL DEFAULT false,
  position        smallint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX repair_order_lines_ro ON repair_order_lines (repair_order_id, position);

-- Work the customer declined. This is the recall list, and the reason the
-- six-month follow-up is worth building.
CREATE TABLE declined_work (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_id      uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  repair_order_id uuid REFERENCES repair_orders(id) ON DELETE SET NULL,
  description     text NOT NULL,
  estimated_cents integer,
  declined_at     timestamptz NOT NULL DEFAULT now(),
  -- When to bring it up again. NULL means never.
  remind_after    timestamptz,
  reminded_at     timestamptz,
  resolved_at     timestamptz
);

CREATE INDEX declined_work_due
  ON declined_work (shop_id, remind_after)
  WHERE resolved_at IS NULL AND reminded_at IS NULL;

-- -----------------------------------------------------------------------------
-- Scheduling
-- -----------------------------------------------------------------------------

CREATE TABLE appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_id      uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  repair_order_id uuid REFERENCES repair_orders(id) ON DELETE SET NULL,
  bay             smallint,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'booked'
                  CHECK (status IN ('booked', 'confirmed', 'arrived', 'no_show', 'cancelled')),
  booked_by_agent boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_range CHECK (ends_at > starts_at)
);

CREATE INDEX appointments_shop_window ON appointments (shop_id, starts_at);

-- Two vehicles cannot occupy one bay at one time. Enforce it in the database:
-- the agent books slots concurrently with humans and last-write-wins would
-- double-book a bay.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_bay_overlap
  EXCLUDE USING gist (
    shop_id WITH =,
    bay WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (bay IS NOT NULL AND status IN ('booked', 'confirmed', 'arrived'));

-- -----------------------------------------------------------------------------
-- Messaging
-- -----------------------------------------------------------------------------

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  repair_order_id uuid REFERENCES repair_orders(id) ON DELETE SET NULL,
  direction       text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel         text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'email')),
  body            text NOT NULL,
  twilio_sid      text UNIQUE,
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'received')),
  error_code      text,
  sent_by_agent   boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_customer ON messages (customer_id, created_at DESC);
CREATE INDEX messages_shop_created ON messages (shop_id, created_at DESC);

-- Outbound work the agent intends to do later: part arrived, car ready,
-- declined-work recall, holiday promotion. Kept as rows rather than in-process
-- timers so a redeploy can't drop somebody's follow-up.
CREATE TABLE follow_ups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  repair_order_id uuid REFERENCES repair_orders(id) ON DELETE CASCADE,
  kind            text NOT NULL
                  CHECK (kind IN ('part_ordered', 'in_progress', 'diagnosis_ready',
                                  'ready_for_pickup', 'declined_work_recall',
                                  'service_due', 'birthday', 'holiday', 'custom')),
  scheduled_for   timestamptz NOT NULL,
  body            text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  sent_at         timestamptz,
  attempts        smallint NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The worker's hot path: what is due right now.
CREATE INDEX follow_ups_due
  ON follow_ups (scheduled_for)
  WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'shops', 'customers', 'vehicles', 'repair_orders', 'appointments'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END $$;
