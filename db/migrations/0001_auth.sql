-- =============================================================================
-- 0001 — staff sign-in
--
-- The schema already had `staff`: the people a shop employs. This turns that
-- row into something a human can log in as, and adds the three tables sign-in
-- needs around it.
--
-- Why passwords rather than Google sign-in or a magic link: the shop owner
-- signing up at 7pm on a Tuesday has a Gmail address, an AOL address, or a
-- shop@ address on a domain their nephew set up, and no appetite for an OAuth
-- consent screen. A magic link needs a sending domain with SPF/DKIM warmed up,
-- which is the same carrier-reputation problem as the SMS side and is not
-- solved today. Passwords work now; SSO can be added beside this later without
-- moving anybody's account.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- staff becomes an account
-- -----------------------------------------------------------------------------

ALTER TABLE staff
  -- NULL until the person sets one. An invited advisor exists as a row, and
  -- as a name on the board, before they have ever signed in.
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  -- Soft delete. Deleting the row would cascade away who approved which
  -- repair order, which is exactly the record we must not lose.
  ADD COLUMN IF NOT EXISTS disabled_at   timestamptz;

-- The schema's UNIQUE (shop_id, email) allows one address at two shops, which
-- is right for a multi-location group later, but sign-in is by email alone and
-- has no shop to disambiguate with. Until there is a shop picker, one address
-- is one person at one shop. Case-insensitive because people capitalise their
-- own email inconsistently and then can't get in.
CREATE UNIQUE INDEX IF NOT EXISTS staff_email_lower ON staff (lower(email));

-- -----------------------------------------------------------------------------
-- Sessions
--
-- Server-side, not a signed JWT, so that "sign out everywhere" and "disable
-- this advisor" take effect on the next request instead of whenever a token
-- happens to expire. The cookie holds a random token; this table holds only
-- its SHA-256. A dump of this table therefore cannot be replayed as a login.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  -- hex SHA-256 of the cookie token.
  id           text PRIMARY KEY,
  staff_id     uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  -- Denormalised from staff so the hot path (every request) is one indexed
  -- lookup rather than a join.
  shop_id      uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text,
  ip           text
);

CREATE INDEX IF NOT EXISTS sessions_staff ON sessions (staff_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

-- -----------------------------------------------------------------------------
-- Invites
--
-- How an advisor or tech gets an account. The owner creates the invite and
-- hands over the link; there is no outbound email yet, and inventing one for
-- this would mean warming a sending domain before the product has users.
-- Same storage rule as sessions: the hash, never the token.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  email       text NOT NULL,
  full_name   text NOT NULL,
  role        text NOT NULL DEFAULT 'advisor'
              CHECK (role IN ('owner', 'advisor', 'tech')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES staff(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at  timestamptz
);

CREATE INDEX IF NOT EXISTS staff_invites_shop ON staff_invites (shop_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Failed sign-in attempts
--
-- Rate limiting has to live in the database: serverless gives every request a
-- different instance, so an in-process counter limits nothing. One row per
-- failure, counted over a window, and pruned by the same query that reads it.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth_attempts (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL,
  ip         text,
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_attempts_email_at ON auth_attempts (lower(email), at DESC);
CREATE INDEX IF NOT EXISTS auth_attempts_at ON auth_attempts (at);
