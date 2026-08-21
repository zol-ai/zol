-- =============================================================================
-- 0002 — repair order numbering
--
-- repair_orders.number is the number written on the paper ticket, unique per
-- shop. Deriving it as max(number) + 1 races: two advisors opening a ticket at
-- the same moment both read the same maximum under READ COMMITTED, and one
-- insert dies on the unique index — during a phone call.
--
-- A counter on the shop row instead. `UPDATE ... RETURNING` takes a row lock,
-- so the second caller waits for the first and gets the next number. It costs
-- one write per ticket and cannot collide.
--
-- Not a Postgres sequence: sequences are per-database, and this has to be per
-- shop, restartable, and something an owner can be told the current value of.
-- Starting at 1000 because a shop's first ticket reading #1 looks like a
-- product demo — and 1000 is what most shops start their own books at.
-- =============================================================================

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS ro_number_seq integer NOT NULL DEFAULT 1000;

-- An existing shop with tickets already on file must not hand out a number it
-- has used. No-op on a shop with no repair orders.
UPDATE shops s
   SET ro_number_seq = greatest(
         s.ro_number_seq,
         (SELECT max(r.number) FROM repair_orders r WHERE r.shop_id = s.id))
 WHERE EXISTS (SELECT 1 FROM repair_orders r WHERE r.shop_id = s.id);
