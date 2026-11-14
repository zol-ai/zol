/**
 * Seed one demo shop with a day's worth of realistic activity.
 *
 *   cd web
 *   DATABASE_URL=postgresql://... node scripts/seed-demo.mjs
 *
 * For a local database only. It refuses to run against Cloud SQL
 * (INSTANCE_CONNECTION_NAME set) unless --allow-cloud is passed, because it
 * deletes and recreates the demo shop by slug and nothing in production
 * should be deleted by a script that ships in the repo.
 *
 * Everything it writes is one tenant, `fifth-street-auto`, and every phone
 * number is in the 555-01xx range reserved for fiction. Sign in as
 * owner@demo.zol / DemoShop2026! afterwards.
 */

import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";

import pg from "pg";

const allowCloud = process.argv.includes("--allow-cloud");
if (process.env.INSTANCE_CONNECTION_NAME && !allowCloud) {
  console.error("Refusing to seed a Cloud SQL instance. Unset INSTANCE_CONNECTION_NAME or pass --allow-cloud.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL.");
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Helpers, mirroring lib/password.ts, lib/auth.ts and lib/schedule.ts
// -----------------------------------------------------------------------------

function scrypt(password, salt, keylen, options) {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

async function hashPassword(password) {
  const N = 2 ** 17;
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, {
    N,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  return ["scrypt", N, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

const TZ = "America/Los_Angeles";

function partsIn(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetAt(date, timeZone) {
  const p = partsIn(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

/** Wall clock in the shop's zone, `dayOffset` days from today, → instant. */
function at(dayOffset, hour, minute = 0) {
  const today = partsIn(new Date(), TZ);
  const naive = Date.UTC(today.year, today.month - 1, today.day + dayOffset, hour, minute);
  let guess = new Date(naive - offsetAt(new Date(naive), TZ));
  guess = new Date(naive - offsetAt(guess, TZ));
  return guess;
}

function minutesAfter(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function whenLabel(date) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${day} at ${time}`;
}

// -----------------------------------------------------------------------------

const SLUG = "fifth-street-auto";
const SHOP = "Fifth Street Auto";
const PASSWORD = "DemoShop2026!";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const q = async (text, params) => (await client.query(text, params)).rows;
const one = async (text, params) => (await q(text, params))[0];

try {
  await client.query("BEGIN");

  // Idempotent: the demo shop is recreated from scratch every run. Cascades
  // take everything under it.
  await q("DELETE FROM shops WHERE slug = $1", [SLUG]);

  const shop = await one(
    `INSERT INTO shops
       (name, slug, timezone, labor_rate_cents, parts_margin_pct, tax_rate_pct,
        bay_count, auto_quote_cap_cents, public_phone, address, email,
        ro_number_seq, estimate_number_seq, invoice_number_seq)
     VALUES ($1, $2, $3, 14500, 35.00, 8.25, 4, 100000, '+16615550100',
             '1120 5th St, Bakersfield, CA 93301', 'service@fifthstreetauto.example',
             1048, 2041, 3052)
     RETURNING id`,
    [SHOP, SLUG, TZ],
  );
  const shopId = shop.id;

  await q(
    `INSERT INTO shop_hours (shop_id, day_of_week, opens_at, closes_at, is_closed)
     SELECT $1, d,
            CASE WHEN d BETWEEN 1 AND 5 THEN TIME '08:00' WHEN d = 6 THEN TIME '09:00' END,
            CASE WHEN d BETWEEN 1 AND 5 THEN TIME '17:00' WHEN d = 6 THEN TIME '13:00' END,
            d = 0
       FROM generate_series(0, 6) AS d`,
    [shopId],
  );

  // --- Staff ----------------------------------------------------------------
  const passwordHash = await hashPassword(PASSWORD);
  const staffRows = [
    ["owner@demo.zol", "Ray Delgado", "owner", [], "+16615550101"],
    ["advisor@demo.zol", "Dana Kowalski", "advisor", [], "+16615550102"],
    ["tech@demo.zol", "Manny Ruiz", "tech", ["Diagnostics", "Electrical", "Driveability"], "+16615550103"],
    ["elena@demo.zol", "Elena Torres", "tech", ["Brakes", "Suspension", "Alignment"], "+16615550104"],
  ];
  const staff = {};
  for (const [email, name, role, specialties, phone] of staffRows) {
    const row = await one(
      `INSERT INTO staff (shop_id, email, full_name, role, password_hash, specialties, phone, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() - interval '1 day')
       RETURNING id`,
      [shopId, email, name, role, passwordHash, specialties, phone],
    );
    staff[email] = { id: row.id, name };
  }
  const advisor = staff["advisor@demo.zol"];
  const manny = staff["tech@demo.zol"];
  const elena = staff["elena@demo.zol"];

  // --- Customers and vehicles ----------------------------------------------
  const customerSpecs = [
    ["Jordan Lee", "+16615550171", "jordan.lee@example.com", "1988-04-12"],
    ["Priya Shah", "+16615550192", "priya.shah@example.com", null],
    ["Daniel Brooks", "+16615550136", "daniel.brooks@example.com", "1979-09-18"],
    ["Sofia Martinez", "+16615550188", "sofia.martinez@example.com", null],
    ["Ethan Walker", "+16615550115", "ethan.walker@example.com", null],
    ["Nina Patel", "+16615550162", "nina.patel@example.com", "1991-11-02"],
    ["Liam Nguyen", "+16615550144", null, null],
    ["Grace Kim", "+16615550120", "grace.kim@example.com", null],
  ];
  const customers = [];
  for (const [name, phone, email, birthday] of customerSpecs) {
    const row = await one(
      `INSERT INTO customers (shop_id, full_name, phone, email, birthday, preferred_contact,
                              address, first_seen_at)
       VALUES ($1, $2, $3, $4, $5, 'sms', $6, now() - interval '400 days' * random())
       RETURNING id`,
      [shopId, name, phone, email, birthday, `${100 + customers.length * 37} Truxtun Ave, Bakersfield, CA`],
    );
    customers.push({ id: row.id, name, phone, email });
  }
  const [jordan, priya, daniel, sofia, ethan, nina, liam, grace] = customers;

  const vehicleSpecs = [
    [jordan, 2015, "Chevrolet", "Sonic", "LT", "1.8L I4", 102430, "8ABC123", "1G1JC5SH0F4100001"],
    [jordan, 2012, "Honda", "Civic", "LX", "1.8L I4", 146110, "6CIV204", "2HGFB2F50CH100009"],
    [priya, 2014, "Jeep", "Compass", "Latitude", "2.4L I4", 128205, "7JEP442", "1C4NJDEB0ED100002"],
    [daniel, 2019, "Toyota", "Camry", "SE", "2.5L I4", 68420, "8CAM919", "4T1B11HK0KU100003"],
    [sofia, 2020, "Honda", "CR-V", "EX", "1.5L Turbo", 44980, "9CRV205", "2HKRW2H50LH100004"],
    [sofia, 2016, "Volkswagen", "Golf", "S", "1.8L Turbo", 78200, "7VW4300", "3VW217AU0GM100010"],
    [ethan, 2018, "Ford", "F-150", "XLT", "3.5L EcoBoost", 89730, "8F15077", "1FTFW1EG0JFA00005"],
    [nina, 2022, "Subaru", "Outback", "Premium", "2.5L H4", 31200, "9SUB212", "4S4BTACC0N3100006"],
    [liam, 2017, "Nissan", "Altima", "SV", "2.5L I4", 91500, "7ALT717", "1N4AL3AP0HC100007"],
    [grace, 2021, "Mazda", "CX-5", "Touring", "2.5L I4", 38770, "9MAZ551", "JM3KFBCM0M0100008"],
  ];
  const vehicles = [];
  for (const [customer, year, make, model, trim, engine, mileage, plate, vin] of vehicleSpecs) {
    const row = await one(
      `INSERT INTO vehicles (shop_id, customer_id, year, make, model, trim, engine, mileage, plate, vin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [shopId, customer.id, year, make, model, trim, engine, mileage, plate, vin],
    );
    vehicles.push({ id: row.id, customer, label: `${year} ${make} ${model}`, mileage });
  }
  const [sonic, , compass, camry, crv, , f150, outback, altima, cx5] = vehicles;

  // --- Appointments ---------------------------------------------------------
  async function appointment({ vehicle, dayOffset, hour, minutes = 60, bay, tech, status, service, complaint, source = "counter", agent = false }) {
    const starts = at(dayOffset, hour);
    const row = await one(
      `INSERT INTO appointments
         (shop_id, customer_id, vehicle_id, bay, starts_at, ends_at, status, booked_by_agent,
          technician_id, service_type, complaint, source, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               CASE WHEN $7 IN ('confirmed', 'arrived') THEN $5::timestamptz - interval '1 day' END)
       RETURNING id`,
      [shopId, vehicle.customer.id, vehicle.id, bay, starts, minutesAfter(starts, minutes), status, agent, tech?.id ?? null, service, complaint, source],
    );
    return { id: row.id, starts, vehicle, tech, service };
  }

  const apptSonic = await appointment({ vehicle: sonic, dayOffset: 0, hour: 8, bay: 1, tech: manny, status: "arrived", service: "Check-engine diagnostic", complaint: "Check engine light is on and the car shakes at idle.", source: "agent", agent: true });
  const apptCompass = await appointment({ vehicle: compass, dayOffset: 0, hour: 10, bay: 2, tech: manny, status: "booked", service: "Engine diagnostic", complaint: "Intermittent stalling at stop lights." });
  const apptCamry = await appointment({ vehicle: camry, dayOffset: 0, hour: 11, bay: 3, tech: elena, status: "confirmed", service: "Brake service", complaint: "Squeal under light braking, pedal travels further than it used to." });
  await appointment({ vehicle: crv, dayOffset: 0, hour: 13, bay: 1, tech: null, status: "booked", service: "Routine maintenance", complaint: "Oil service, tire rotation, multipoint inspection." });
  await appointment({ vehicle: f150, dayOffset: 0, hour: 15, bay: 2, tech: elena, status: "booked", service: "Suspension", complaint: "Clunk over bumps from the front passenger side." });
  await appointment({ vehicle: outback, dayOffset: 1, hour: 8, bay: 1, tech: null, status: "confirmed", service: "30k service", complaint: "Factory scheduled maintenance." });
  await appointment({ vehicle: altima, dayOffset: 1, hour: 10, bay: 3, tech: manny, status: "booked", service: "Cooling system", complaint: "Temperature gauge climbs in traffic." });
  await appointment({ vehicle: cx5, dayOffset: 1, hour: 13, bay: null, tech: null, status: "booked", service: "Pre-trip inspection", complaint: "Long drive next week; wants it looked over.", source: "web" });
  await appointment({ vehicle: camry, dayOffset: -1, hour: 14, bay: 3, tech: elena, status: "arrived", service: "Brake inspection", complaint: "Front brake noise." });

  // --- Repair orders --------------------------------------------------------
  async function repairOrder({ number, vehicle, status, complaint, tech, mileage, appointment: appt, createdDaysAgo = 0, cause, correction, priority = "normal", fuel = 50, promisedHoursFromNow = null, source = "counter", closedDaysAgo = null }) {
    const created = new Date(Date.now() - createdDaysAgo * 86_400_000);
    const row = await one(
      `INSERT INTO repair_orders
         (shop_id, number, customer_id, vehicle_id, technician_id, status, complaint, cause, correction,
          mileage_in, fuel_level, checked_in_at, priority, source, promised_at, created_at,
          completed_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               CASE WHEN $6 <> 'open' OR $12::uuid IS NOT NULL THEN $13::timestamptz END,
               $14, $15, $16, $13,
               CASE WHEN $6 IN ('ready', 'closed') THEN coalesce($17::timestamptz, now()) END,
               $17)
       RETURNING id`,
      [
        shopId, number, vehicle.customer.id, vehicle.id, tech?.id ?? null, status, complaint,
        cause ?? null, correction ?? null, mileage ?? vehicle.mileage, fuel, appt?.id ?? null,
        created, priority, source,
        promisedHoursFromNow != null ? new Date(Date.now() + promisedHoursFromNow * 3_600_000) : null,
        closedDaysAgo != null ? new Date(Date.now() - closedDaysAgo * 86_400_000) : null,
      ],
    );
    if (appt) await q("UPDATE appointments SET repair_order_id = $1, checked_in_at = coalesce(checked_in_at, $3) WHERE id = $2", [row.id, appt.id, created]);
    await q(
      `INSERT INTO repair_order_events (shop_id, repair_order_id, kind, detail, to_status, actor, staff_id, created_at)
       VALUES ($1, $2, 'opened', $3, 'open', $4, $5, $6)`,
      [shopId, row.id, `Ticket #${number} opened${source === "agent" ? " from a call ZOL took" : ""}.`, source === "agent" ? "zol" : "person", source === "agent" ? null : advisor.id, created],
    );
    if (status !== "open") {
      await q(
        `INSERT INTO repair_order_events (shop_id, repair_order_id, kind, detail, from_status, to_status, actor, staff_id, created_at)
         VALUES ($1, $2, 'status_changed', $3, 'open', $4, 'person', $5, $6::timestamptz + interval '30 minutes')`,
        [shopId, row.id, `Open → ${status.replace(/_/g, " ")}`, status, tech?.id ?? advisor.id, created],
      );
    }
    return { id: row.id, number, vehicle, tech, status };
  }

  async function line(ro, kind, description, quantity, unitCents, approval = "pending", position = 0) {
    const total = Math.round(quantity * unitCents);
    return one(
      `INSERT INTO repair_order_lines
         (repair_order_id, kind, description, quantity, unit_cents, total_cents, approval, approved_at, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'approved' THEN now() END, $8)
       RETURNING id, total_cents`,
      [ro.id, kind, description, quantity, unitCents, total, approval, position],
    );
  }

  async function recalc(roId) {
    await q(
      `UPDATE repair_orders ro
          SET total_cents = t.subtotal + t.tax
         FROM (SELECT l.repair_order_id,
                      coalesce(sum(l.total_cents), 0)::int AS subtotal,
                      round(coalesce(sum(l.total_cents) FILTER (WHERE l.kind IN ('part','fee')), 0)
                            * (SELECT tax_rate_pct FROM shops WHERE id = $1) / 100)::int AS tax
                 FROM repair_order_lines l WHERE l.approval <> 'declined' GROUP BY l.repair_order_id) t
        WHERE ro.id = t.repair_order_id AND ro.id = $2`,
      [shopId, roId],
    );
  }

  // #1048 — Jordan's Sonic, diagnosing (arrived from the call ZOL took)
  const ro1048 = await repairOrder({ number: 1048, vehicle: sonic, status: "diagnosing", complaint: "Check engine light is on and the car shakes at idle. Feels weaker than normal.", tech: manny, appointment: apptSonic, source: "agent", fuel: 40, priority: "high", promisedHoursFromNow: 8 });
  await line(ro1048, "labor", "Check-engine diagnostic", 1, 14500, "approved", 0);
  await recalc(ro1048.id);
  await q(
    `INSERT INTO diagnostics (shop_id, repair_order_id, vehicle_id, technician_id, obd_codes, symptoms, observations, ai_result, ai_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'fallback')`,
    [
      shopId, ro1048.id, sonic.id, manny.id, ["P0301", "P0171"],
      "Rough idle, misfire counter climbing on cylinder 1, long-term fuel trim +18% at idle.",
      "Coil pack on cyl 1 shows heat discolouration. Vacuum lines look original. No exhaust leak audible.",
      JSON.stringify({
        causes: [
          { title: "Failed ignition coil, cylinder 1", confidence: 74, explanation: "P0301 with a climbing misfire counter and visible heat damage on the coil points at ignition first.", supporting: ["P0301", "Rough idle", "Coil discolouration"] },
          { title: "Vacuum leak leaning the mixture", confidence: 52, explanation: "+18% long-term trim at idle that improves off idle is the classic unmetered-air pattern.", supporting: ["P0171", "LTFT +18% at idle"] },
          { title: "Worn spark plugs", confidence: 38, explanation: "At 102k on original plugs a weak spark can seed a single-cylinder misfire.", supporting: ["Mileage", "P0301"] },
        ],
        testPlan: ["Swap coil 1 with coil 3 and re-scan for the misfire to move", "Smoke test the intake for unmetered air", "Pull plugs and gap/inspect", "Check fuel trims again after repairs"],
        warnings: ["AI-assisted ranking from technician-entered facts. Technician verification required before any repair is quoted."],
      }),
    ],
  );
  const insp1048 = await one(
    `INSERT INTO inspections (shop_id, repair_order_id, vehicle_id, technician_id, overall)
     VALUES ($1, $2, $3, $4, 'not_inspected') RETURNING id`,
    [shopId, ro1048.id, sonic.id, manny.id],
  );
  const categories = ["Engine", "Transmission", "Brakes", "Tires", "Suspension", "Steering", "Battery", "Fluids", "Lights", "Heating & A/C", "Exterior", "Interior", "Safety"];
  const ratings1048 = { Engine: ["yellow", "Misfire on cyl 1, see diagnostic", null], Brakes: ["yellow", "Front pads at 4mm", "4 mm"], Tires: ["green", null, "6/32 all round"], Battery: ["green", null, "12.6 V, 540 CCA"], Fluids: ["green", null, null], Lights: ["green", null, null] };
  for (const [i, category] of categories.entries()) {
    const [rating, notes, measurement] = ratings1048[category] ?? ["not_inspected", null, null];
    await q(
      `INSERT INTO inspection_items (inspection_id, category, name, rating, notes, measurement, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [insp1048.id, category, `${category} condition`, rating, notes, measurement, i],
    );
  }

  // #1047 — Priya's Compass, estimate sent, waiting on approval
  const ro1047 = await repairOrder({ number: 1047, vehicle: compass, status: "awaiting_approval", complaint: "Intermittent stalling at stop lights; hesitation pulling away.", tech: manny, appointment: apptCompass, createdDaysAgo: 1, cause: "MAP sensor reading erratic under load; throttle body heavily carboned.", fuel: 60 });
  const l1 = await line(ro1047, "labor", "Replace MAP sensor and clean throttle body", 2, 14500, "pending", 0);
  const l2 = await line(ro1047, "part", "MAP sensor (OE)", 1, 8900, "pending", 1);
  const l3 = await line(ro1047, "part", "Throttle body cleaner", 1, 1250, "pending", 2);
  const l4 = await line(ro1047, "fee", "Shop supplies", 1, 1500, "pending", 3);
  await recalc(ro1047.id);
  {
    const lines = [l1, l2, l3, l4];
    const subtotal = lines.reduce((s, l) => s + l.total_cents, 0);
    const taxable = l2.total_cents + l3.total_cents + l4.total_cents;
    const tax = Math.round((taxable * 8.25) / 100);
    const est = await one(
      `INSERT INTO estimates (shop_id, repair_order_id, customer_id, vehicle_id, number, status, subtotal_cents, tax_cents, total_cents, note, sent_at, viewed_at, expires_at, created_by)
       VALUES ($1, $2, $3, $4, 2041, 'viewed', $5, $6, $7, $8, now() - interval '20 hours', now() - interval '18 hours', now() + interval '13 days', $9)
       RETURNING id`,
      [shopId, ro1047.id, priya.id, compass.id, subtotal, tax, subtotal + tax,
        "The stalling comes from a manifold pressure sensor that is reading erratically, and the throttle body behind it is heavily carboned. Replacing the sensor and cleaning the throttle body addresses both.", advisor.id],
    );
    const descs = [["labor", "Replace MAP sensor and clean throttle body", 2, 14500], ["part", "MAP sensor (OE)", 1, 8900], ["part", "Throttle body cleaner", 1, 1250], ["fee", "Shop supplies", 1, 1500]];
    for (const [i, l] of lines.entries()) {
      const [kind, description, qty, unit] = descs[i];
      await q(
        `INSERT INTO estimate_lines (estimate_id, repair_order_line_id, kind, description, quantity, unit_cents, total_cents, approval, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
        [est.id, l.id, kind, description, qty, unit, l.total_cents, i],
      );
    }
    const { token, hash } = newToken();
    await q(
      `INSERT INTO portal_tokens (shop_id, customer_id, repair_order_id, token_hash, expires_at, last_viewed_at)
       VALUES ($1, $2, $3, $4, now() + interval '90 days', now() - interval '18 hours')`,
      [shopId, priya.id, ro1047.id, hash],
    );
    console.log(`portal (estimate #2041, Priya):  /portal/${token}`);
    await q(
      `INSERT INTO repair_order_events (shop_id, repair_order_id, kind, detail, actor, staff_id, created_at)
       VALUES ($1, $2, 'estimate_sent', 'Estimate #2041 sent to the customer.', 'person', $3, now() - interval '20 hours'),
              ($1, $2, 'estimate_viewed', 'Customer opened estimate #2041.', 'zol', NULL, now() - interval '18 hours')`,
      [shopId, ro1047.id, advisor.id],
    );
    await q(
      `INSERT INTO messages (shop_id, customer_id, repair_order_id, direction, channel, body, status, sent_by_agent, created_at)
       VALUES ($1, $2, $3, 'outbound', 'portal', $4, 'delivered', true, now() - interval '20 hours')`,
      [shopId, priya.id, ro1047.id, `${SHOP}: your estimate for the 2014 Jeep Compass is ready — $457.23. Review and approve it from your repair page.`],
    );
    await q(
      `INSERT INTO follow_ups (shop_id, customer_id, repair_order_id, vehicle_id, kind, scheduled_for, body, title, status, sent_at, channel, source)
       VALUES ($1, $2, $3, $4, 'estimate_ready', now() - interval '20 hours', $5, 'Estimate ready', 'sent', now() - interval '20 hours', 'sms', 'zol')`,
      [shopId, priya.id, ro1047.id, compass.id, `${SHOP}: your estimate for the 2014 Jeep Compass is ready — $457.23. Review and approve it here.`],
    );
  }

  // #1046 — Daniel's Camry, waiting on parts
  const ro1046 = await repairOrder({ number: 1046, vehicle: camry, status: "awaiting_parts", complaint: "Squeal under light braking, long pedal.", tech: elena, appointment: apptCamry, createdDaysAgo: 1, cause: "Front pads at 2mm, rotors below minimum thickness.", fuel: 75, promisedHoursFromNow: 30 });
  const l46a = await line(ro1046, "labor", "Front brake pads and rotors, replace", 1.8, 14500, "approved", 0);
  const l46b = await line(ro1046, "part", "Front brake pads, ceramic", 1, 7800, "approved", 1);
  const l46c = await line(ro1046, "part", "Front rotors (pair)", 1, 15600, "approved", 2);
  await recalc(ro1046.id);
  void l46a;
  await q(
    `INSERT INTO parts (shop_id, repair_order_id, repair_order_line_id, name, part_number, supplier, quantity, unit_cost_cents, unit_price_cents, status, ordered_at, expected_at, received_at)
     VALUES ($1, $2, $3, 'Front brake pads, ceramic', 'D1211-8', 'WorldPac', 1, 5200, 7800, 'ordered', now() - interval '20 hours', $5, NULL),
            ($1, $2, $4, 'Front rotors (pair)', '31471', 'NAPA', 2, 5200, 7800, 'received', now() - interval '20 hours', now() - interval '2 hours', now() - interval '1 hour')`,
    [shopId, ro1046.id, l46b.id, l46c.id, at(1, 9)],
  );
  await q(
    `INSERT INTO messages (shop_id, customer_id, repair_order_id, direction, channel, body, status, sent_by_agent, created_at)
     VALUES ($1, $2, $3, 'inbound', 'sms', 'Any update on the parts for the Camry?', 'received', false, now() - interval '3 hours'),
            ($1, $2, $3, 'outbound', 'portal', $4, 'delivered', true, now() - interval '19 hours')`,
    [shopId, daniel.id, ro1046.id, `${SHOP}: the parts for your 2019 Toyota Camry are on order. We'll let you know the moment they arrive.`],
  );

  // #1045 — Ethan's F-150, on the lift
  const ro1045 = await repairOrder({ number: 1045, vehicle: f150, status: "in_progress", complaint: "Clunk over bumps, front passenger side.", tech: elena, createdDaysAgo: 2, cause: "Both front sway bar end links worn out.", fuel: 30 });
  await line(ro1045, "labor", "Replace front sway bar end links", 1.2, 14500, "approved", 0);
  await line(ro1045, "part", "Sway bar end link (pair)", 1, 9400, "approved", 1);
  await recalc(ro1045.id);

  // #1044 — Sofia's CR-V, ready, invoice open
  const ro1044 = await repairOrder({ number: 1044, vehicle: crv, status: "ready", complaint: "Oil service, tire rotation, multipoint inspection.", tech: manny, createdDaysAgo: 1, cause: "Routine.", correction: "Oil and filter changed, tires rotated, cabin filter replaced.", fuel: 80 });
  const l44a = await line(ro1044, "labor", "Oil and filter service", 0.5, 14500, "approved", 0);
  const l44b = await line(ro1044, "part", "Full synthetic 0W-20, 4.2 qt", 1, 4200, "approved", 1);
  const l44c = await line(ro1044, "part", "Oil filter", 1, 1150, "approved", 2);
  const l44d = await line(ro1044, "labor", "Tire rotation", 0.4, 14500, "approved", 3);
  const l44e = await line(ro1044, "part", "Cabin air filter", 1, 2900, "approved", 4);
  await recalc(ro1044.id);
  {
    const lines = [l44a, l44b, l44c, l44d, l44e];
    const subtotal = lines.reduce((s, l) => s + l.total_cents, 0);
    const taxable = l44b.total_cents + l44c.total_cents + l44e.total_cents;
    const tax = Math.round((taxable * 8.25) / 100);
    const inv = await one(
      `INSERT INTO invoices (shop_id, repair_order_id, customer_id, vehicle_id, number, status, subtotal_cents, tax_cents, total_cents, paid_cents, due_at, created_by)
       VALUES ($1, $2, $3, $4, 3052, 'open', $5, $6, $7, 0, now() + interval '7 days', $8) RETURNING id`,
      [shopId, ro1044.id, sofia.id, crv.id, subtotal, tax, subtotal + tax, advisor.id],
    );
    const descs = [["labor", "Oil and filter service", 0.5, 14500], ["part", "Full synthetic 0W-20, 4.2 qt", 1, 4200], ["part", "Oil filter", 1, 1150], ["labor", "Tire rotation", 0.4, 14500], ["part", "Cabin air filter", 1, 2900]];
    for (const [i, [kind, description, qty, unit]] of descs.entries()) {
      await q(
        `INSERT INTO invoice_lines (invoice_id, kind, description, quantity, unit_cents, total_cents, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [inv.id, kind, description, qty, unit, Math.round(qty * unit), i],
      );
    }
    const insp = await one(
      `INSERT INTO inspections (shop_id, repair_order_id, vehicle_id, technician_id, overall, completed_at, summary, summary_source)
       VALUES ($1, $2, $3, $4, 'yellow', now() - interval '3 hours', $5, 'fallback') RETURNING id`,
      [shopId, ro1044.id, crv.id, manny.id, JSON.stringify({
        summary: "Everything checked is in good shape apart from the rear wiper blade and a battery that is starting to age. Nothing urgent.",
        urgent: [], recommended: ["Battery: 12.3 V at rest, 410 CCA against a 500 CCA rating — plan on a replacement before winter."],
        maintenance: ["Rear wiper blade streaking"], safety: [],
      })],
    );
    const r = { Engine: ["green"], Transmission: ["green"], Brakes: ["green", "Pads 8mm front, 7mm rear", "8 mm / 7 mm"], Tires: ["green", "Rotated", "7/32"], Suspension: ["green"], Steering: ["green"], Battery: ["yellow", "12.3 V at rest, 410 CCA (rated 500)", "12.3 V"], Fluids: ["green"], Lights: ["green"], "Heating & A/C": ["green"], Exterior: ["yellow", "Rear wiper blade streaking", null], Interior: ["green"], Safety: ["green"] };
    for (const [i, category] of categories.entries()) {
      const [rating, notes, measurement] = r[category] ?? ["not_inspected"];
      await q(`INSERT INTO inspection_items (inspection_id, category, name, rating, notes, measurement, position) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [insp.id, category, `${category} condition`, rating, notes ?? null, measurement ?? null, i]);
    }
    const { token, hash } = newToken();
    await q(`INSERT INTO portal_tokens (shop_id, customer_id, repair_order_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, now() + interval '90 days')`, [shopId, sofia.id, ro1044.id, hash]);
    console.log(`portal (invoice #3052, Sofia):   /portal/${token}`);
    await q(
      `INSERT INTO follow_ups (shop_id, customer_id, repair_order_id, vehicle_id, kind, scheduled_for, body, title, status, sent_at, channel, source)
       VALUES ($1, $2, $3, $4, 'ready_for_pickup', now() - interval '2 hours', $5, 'Ready for pickup', 'sent', now() - interval '2 hours', 'sms', 'zol'),
              ($1, $2, $3, $4, 'inspection_recommendation', now() + interval '45 days', $6, 'From your inspection', 'pending', NULL, 'sms', 'zol')`,
      [shopId, sofia.id, ro1044.id, crv.id,
        `${SHOP}: your 2020 Honda CR-V is ready to pick up. Total $219.81. Pay ahead or see the invoice from your repair page.`,
        `${SHOP}: from your CR-V's last inspection, the battery is starting to age. Reply to book it in before winter.`],
    );
    await q(
      `INSERT INTO messages (shop_id, customer_id, repair_order_id, direction, channel, body, status, sent_by_agent, created_at)
       VALUES ($1, $2, $3, 'outbound', 'portal', $4, 'delivered', true, now() - interval '2 hours')`,
      [shopId, sofia.id, ro1044.id, `${SHOP}: your 2020 Honda CR-V is ready to pick up. Total $219.81. Pay ahead or see the invoice from your repair page.`],
    );
    await q(
      `INSERT INTO repair_order_events (shop_id, repair_order_id, kind, detail, actor, staff_id, created_at)
       VALUES ($1, $2, 'inspection_completed', 'Inspection completed: 11 good, 2 to watch.', 'person', $3, now() - interval '3 hours'),
              ($1, $2, 'invoice_created', 'Invoice #3052 created for $219.81.', 'person', $4, now() - interval '2 hours')`,
      [shopId, ro1044.id, manny.id, advisor.id],
    );
  }

  // #1043 — Liam's Altima, quality check
  const ro1043 = await repairOrder({ number: 1043, vehicle: altima, status: "quality_check", complaint: "Temperature gauge climbs in traffic.", tech: manny, createdDaysAgo: 2, cause: "Cooling fan relay failed.", correction: "Relay replaced, system pressure tested, no leaks.", fuel: 55 });
  await line(ro1043, "labor", "Diagnose overheating, replace cooling fan relay", 1.3, 14500, "approved", 0);
  await line(ro1043, "part", "Cooling fan relay", 1, 3400, "approved", 1);
  await recalc(ro1043.id);

  // #1042 — Grace's CX-5, closed and paid 3 days ago
  const ro1042 = await repairOrder({ number: 1042, vehicle: cx5, status: "closed", complaint: "Pre-trip safety inspection.", tech: elena, createdDaysAgo: 4, cause: "Routine.", correction: "Inspected, tires rotated, wiper blades replaced.", fuel: 90, closedDaysAgo: 3 });
  const l42a = await line(ro1042, "labor", "Multipoint inspection and tire rotation", 0.8, 14500, "approved", 0);
  const l42b = await line(ro1042, "part", "Wiper blades (pair)", 1, 3600, "approved", 1);
  await recalc(ro1042.id);
  {
    const subtotal = l42a.total_cents + l42b.total_cents;
    const tax = Math.round((l42b.total_cents * 8.25) / 100);
    const total = subtotal + tax;
    const inv = await one(
      `INSERT INTO invoices (shop_id, repair_order_id, customer_id, vehicle_id, number, status, subtotal_cents, tax_cents, total_cents, paid_cents, paid_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, 3051, 'paid', $5, $6, $7, $7, now() - interval '3 days', $8, now() - interval '3 days') RETURNING id`,
      [shopId, ro1042.id, grace.id, cx5.id, subtotal, tax, total, advisor.id],
    );
    await q(`INSERT INTO invoice_lines (invoice_id, kind, description, quantity, unit_cents, total_cents, position) VALUES ($1,'labor','Multipoint inspection and tire rotation',0.8,14500,$2,0), ($1,'part','Wiper blades (pair)',1,3600,3600,1)`, [inv.id, l42a.total_cents]);
    await q(
      `INSERT INTO payments (shop_id, invoice_id, amount_cents, method, provider, provider_ref, status, note, recorded_by, processed_at, created_at)
       VALUES ($1, $2, $3, 'card', 'demo', 'demo_seed_3051', 'succeeded', 'Demo payment — no processor configured', NULL, now() - interval '3 days', now() - interval '3 days')`,
      [shopId, inv.id, total],
    );
    await q(
      `INSERT INTO follow_ups (shop_id, customer_id, repair_order_id, vehicle_id, kind, scheduled_for, body, title, details, status, channel, source)
       VALUES ($1, $2, $3, $4, 'post_repair', now() + interval '12 hours', $5, 'Post-repair check-in', 'Paid invoice #3051 three days ago. Ask how the CX-5 is running.', 'pending', 'sms', 'zol')`,
      [shopId, grace.id, ro1042.id, cx5.id, `${SHOP}: how is the 2021 Mazda CX-5 running since the visit? If anything isn't right, reply here and we'll sort it.`],
    );
    await q(
      `INSERT INTO repair_order_events (shop_id, repair_order_id, kind, detail, actor, staff_id, created_at)
       VALUES ($1, $2, 'payment_recorded', $3, 'zol', NULL, now() - interval '3 days'),
              ($1, $2, 'closed', 'Paid and closed.', 'zol', NULL, now() - interval '3 days')`,
      // Same words the payment provider writes, from the same cents.
      [shopId, ro1042.id, `Payment of $${(total / 100).toFixed(2)} recorded (demo card) against invoice #3051.`],
    );
  }

  // #1041 — Nina's Outback, closed 20 days ago, with declined work
  const ro1041 = await repairOrder({ number: 1041, vehicle: outback, status: "closed", complaint: "Brake noise from the rear.", tech: elena, createdDaysAgo: 21, cause: "Rear pads at 3mm; customer declined for now.", correction: "Cleaned and lubricated slides; advised on remaining life.", fuel: 60, closedDaysAgo: 20 });
  const l41 = await line(ro1041, "labor", "Rear brake inspection, clean and lubricate", 0.6, 14500, "approved", 0);
  await line(ro1041, "labor", "Rear brake pads, replace", 1.2, 14500, "declined", 1);
  await line(ro1041, "part", "Rear brake pads", 1, 6900, "declined", 2);
  await recalc(ro1041.id);
  {
    const total = l41.total_cents;
    const inv = await one(
      `INSERT INTO invoices (shop_id, repair_order_id, customer_id, vehicle_id, number, status, subtotal_cents, tax_cents, total_cents, paid_cents, paid_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, 3050, 'paid', $5, 0, $5, $5, now() - interval '20 days', $6, now() - interval '20 days') RETURNING id`,
      [shopId, ro1041.id, nina.id, outback.id, total, advisor.id],
    );
    await q(`INSERT INTO invoice_lines (invoice_id, kind, description, quantity, unit_cents, total_cents, position) VALUES ($1,'labor','Rear brake inspection, clean and lubricate',0.6,14500,$2,0)`, [inv.id, total]);
    await q(
      `INSERT INTO payments (shop_id, invoice_id, amount_cents, method, provider, status, note, recorded_by, processed_at, created_at)
       VALUES ($1, $2, $3, 'cash', 'manual', 'succeeded', 'Paid at the counter', $4, now() - interval '20 days', now() - interval '20 days')`,
      [shopId, inv.id, total, advisor.id],
    );
    const declined = await one(
      `INSERT INTO declined_work (shop_id, customer_id, vehicle_id, repair_order_id, description, estimated_cents, declined_at, remind_after)
       VALUES ($1, $2, $3, $4, 'Rear brake pads at 3mm — replace', 24300, now() - interval '20 days', now() - interval '1 day') RETURNING id`,
      [shopId, nina.id, outback.id, ro1041.id],
    );
    await q(
      `INSERT INTO follow_ups (shop_id, customer_id, repair_order_id, vehicle_id, declined_work_id, kind, scheduled_for, body, title, details, status, channel, source)
       VALUES ($1, $2, $3, $4, $5, 'declined_work_recall', now() - interval '1 day', $6, 'Declined work: rear brake pads', 'Declined 20 days ago at 3mm. Worth raising before it becomes rotors too.', 'pending', 'sms', 'zol')`,
      [shopId, nina.id, ro1041.id, outback.id, declined.id, `${SHOP}: when your 2022 Subaru Outback was in we noted the rear brake pads it will need. Want us to take care of it on your next visit? Reply here.`],
    );
  }

  // A couple more historical closed tickets for the customer pages.
  for (const [number, vehicle, daysAgo, complaint, correction, cents] of [
    [1040, sonic, 95, "Oil service", "Oil and filter changed.", 8900],
    [1039, camry, 130, "Alignment", "Four-wheel alignment.", 12900],
    [1038, f150, 200, "Battery dead", "Battery replaced, terminals cleaned.", 24900],
  ]) {
    const ro = await repairOrder({ number, vehicle, status: "closed", complaint, tech: elena, createdDaysAgo: daysAgo, correction, closedDaysAgo: daysAgo - 1 });
    const l = await line(ro, "labor", correction, 1, cents, "approved", 0);
    await recalc(ro.id);
    const inv = await one(
      `INSERT INTO invoices (shop_id, repair_order_id, customer_id, vehicle_id, number, status, subtotal_cents, tax_cents, total_cents, paid_cents, paid_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'paid', $6, 0, $6, $6, $7, $7) RETURNING id`,
      [shopId, ro.id, vehicle.customer.id, vehicle.id, 3000 + (number - 1000), l.total_cents, new Date(Date.now() - (daysAgo - 1) * 86_400_000)],
    );
    await q(`INSERT INTO invoice_lines (invoice_id, kind, description, quantity, unit_cents, total_cents, position) VALUES ($1,'labor',$2,1,$3,$3,0)`, [inv.id, correction, cents]);
    await q(`INSERT INTO payments (shop_id, invoice_id, amount_cents, method, provider, status, recorded_by, processed_at, created_at) VALUES ($1,$2,$3,'card','manual','succeeded',$4,$5,$5)`, [shopId, inv.id, cents, advisor.id, new Date(Date.now() - (daysAgo - 1) * 86_400_000)]);
  }
  await q("UPDATE shops SET ro_number_seq = 1048, estimate_number_seq = 2041, invoice_number_seq = 3052 WHERE id = $1", [shopId]);

  // --- The call ZOL took yesterday evening ----------------------------------
  const callStarted = at(-1, 18, 41);
  const conversation = await one(
    `INSERT INTO conversations (shop_id, customer_id, vehicle_id, channel, phone, status, intake, intake_source, summary, appointment_id, created_at)
     VALUES ($1, $2, $3, 'voice', $4, 'booked', $5, 'fallback', $6, $7, $8) RETURNING id`,
    [shopId, jordan.id, sonic.id, jordan.phone, JSON.stringify({
      customerName: "Jordan Lee", phone: jordan.phone,
      vehicle: { year: 2015, make: "Chevrolet", model: "Sonic" },
      complaint: "Check engine light with shaking at idle",
      symptoms: ["Check engine light (steady)", "Rough idle", "Shaking while stopped", "Reduced power"],
      urgency: "soon", serviceType: "Check-engine diagnostic", preferredTime: "Earliest tomorrow morning",
      summary: "Returning customer reports a steady check-engine light, rough idle and reduced power on a 2015 Chevrolet Sonic; asked for the earliest morning diagnostic.",
      safetyAdvice: "Stop driving if the light starts flashing or the car loses significant power.",
    }),
      "Returning customer, steady check-engine light and rough idle on the 2015 Sonic. Booked the 8:00 diagnostic with Manny and texted confirmation.",
      apptSonic.id, callStarted],
  );
  const transcript = [
    ["assistant", `Thanks for calling ${SHOP}, this is ZOL. How can I help?`],
    ["customer", "Hi, it's Jordan Lee. My 2015 Chevy Sonic has the check engine light on and it shakes when I'm stopped."],
    ["assistant", "Sorry to hear that — let's get it looked at. Is the light steady or flashing, and have you noticed any stalling, overheating or loss of power?"],
    ["customer", "It stays on steady. No overheating or stalling, but it feels weaker than normal."],
    ["assistant", "Okay. A steady light with a rough idle should be checked soon. If it starts flashing or loses a lot of power, please pull over and stop driving. Would tomorrow morning work?"],
    ["customer", "Yes, the earliest you have tomorrow would be great."],
    ["assistant", "I have your Sonic on file. The earliest diagnostic slot is 8:00 tomorrow with Manny — shall I book that and text you the confirmation?"],
    ["customer", "Perfect, thank you."],
    ["assistant", "Done — you're booked for 8:00 tomorrow. The confirmation is on its way to this number. Anything else?"],
    ["customer", "No, that's it."],
  ];
  for (const [i, [role, content]] of transcript.entries()) {
    await q(
      `INSERT INTO conversation_messages (conversation_id, role, content, created_at) VALUES ($1, $2, $3, $4)`,
      [conversation.id, role, content, new Date(callStarted.getTime() + i * 14_000)],
    );
  }
  const call = await one(
    `INSERT INTO calls (shop_id, customer_id, direction, from_number, to_number, started_at, ended_at, duration_seconds,
                        outcome, transcript, status, caller_name, summary, intake, vehicle_id, appointment_id,
                        conversation_id, sentiment, simulated, handled_by, created_at)
     VALUES ($1, $2, 'inbound', $3, '+16615550100', $4, $5, 143, 'booked', $6, 'completed', 'Jordan Lee', $7, $8, $9, $10, $11,
             'Concerned, cooperative', true, 'zol', $4) RETURNING id`,
    [shopId, jordan.id, jordan.phone, callStarted, new Date(callStarted.getTime() + 143_000),
      JSON.stringify(transcript.map(([role, content]) => ({ role, content }))),
      "Returning customer, steady check-engine light and rough idle on the 2015 Sonic. Booked the 8:00 diagnostic with Manny and texted confirmation.",
      JSON.stringify({ complaint: "Check engine light with shaking at idle", urgency: "soon", serviceType: "Check-engine diagnostic", preferredTime: "Earliest tomorrow morning" }),
      sonic.id, apptSonic.id, conversation.id],
  );
  await q("UPDATE appointments SET call_id = $1 WHERE id = $2", [call.id, apptSonic.id]);
  await q("UPDATE repair_orders SET opened_by_call_id = $1 WHERE id = $2", [call.id, ro1048.id]);
  await q(
    `INSERT INTO messages (shop_id, customer_id, direction, channel, body, status, sent_by_agent, created_at)
     VALUES ($1, $2, 'outbound', 'portal', $3, 'delivered', true, $4)`,
    [shopId, jordan.id, `${SHOP}: you're booked for ${whenLabel(apptSonic.starts)} with Manny Ruiz — Check-engine diagnostic. Reply to this text or call (661) 555-0100 if you need to change it.`, new Date(callStarted.getTime() + 150_000)],
  );
  await q(
    `INSERT INTO follow_ups (shop_id, customer_id, vehicle_id, kind, scheduled_for, body, title, status, sent_at, channel, source)
     VALUES ($1, $2, $3, 'appointment_confirmed', $4, $5, 'Booking confirmed', 'sent', $4, 'sms', 'zol')`,
    [shopId, jordan.id, sonic.id, new Date(callStarted.getTime() + 150_000), `${SHOP}: you're booked for ${whenLabel(apptSonic.starts)} with Manny Ruiz — Check-engine diagnostic.`],
  );

  // A birthday coming up, for the CRM.
  await q(
    `INSERT INTO follow_ups (shop_id, customer_id, kind, scheduled_for, body, title, status, channel, source)
     VALUES ($1, $2, 'birthday', now() + interval '2 days', $3, 'Birthday', 'pending', 'sms', 'zol')`,
    [shopId, daniel.id, `${SHOP}: happy birthday, Daniel, from all of us at the shop.`],
  );

  // --- Notifications for the bell --------------------------------------------
  await q(
    `INSERT INTO notifications (shop_id, kind, title, body, href, created_at) VALUES
       ($1, 'call', 'ZOL booked a diagnostic', 'Jordan Lee · 2015 Chevrolet Sonic · 8:00 AM with Manny', $2, $3),
       ($1, 'estimate', 'Estimate #2041 opened', 'Priya Shah opened the estimate for the Compass. No answer yet.', $4, now() - interval '18 hours'),
       ($1, 'message', 'Text from Daniel Brooks', 'Any update on the parts for the Camry?', $5, now() - interval '3 hours'),
       ($1, 'part', 'Rotors received for #1046', 'NAPA delivered. Pads still on order from WorldPac, due tomorrow 9:00.', $5, now() - interval '1 hour')`,
    [shopId, `/app/calls/${call.id}`, new Date(callStarted.getTime() + 160_000), `/app/repair-orders/${ro1047.id}`, `/app/repair-orders/${ro1046.id}`],
  );

  await client.query("COMMIT");

  console.log(`\nSeeded ${SHOP} (${SLUG}).`);
  console.log(`  sign in: owner@demo.zol / ${PASSWORD}   (also advisor@demo.zol, tech@demo.zol, elena@demo.zol)`);
  console.log(`  public receptionist: /talk/${SLUG}`);
  console.log(`  tickets #1038–#1048, estimate #2041, invoices #3038–#3052`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("seed failed:", error.message);
  if (error.position) console.error("  at position", error.position);
  process.exitCode = 1;
} finally {
  await client.end();
}
