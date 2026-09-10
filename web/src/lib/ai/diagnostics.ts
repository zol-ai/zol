import "server-only";

import { z } from "zod";

import { structuredCompletion } from "./client";

/**
 * Codes and symptoms in, ranked causes and a test plan out.
 *
 * Two engines behind one function. With an OpenAI key the model does the
 * ranking, constrained to the schema below and told the facts and nothing
 * else. Without one — or when the call fails — the fallback does it from a
 * table of code families and symptom words that any working technician
 * carries in their head. Both produce the same shape, both are labelled, and
 * neither is ever the last word: the final warning on every result says a
 * technician has to verify it, and the ticket's `cause` is only written when
 * a person types the verification.
 *
 * Nothing here prices anything. Prices come from lines the shop types.
 */

export const VERIFICATION_WARNING =
  "AI-assisted ranking from technician-entered facts. Technician verification required before any repair is quoted.";

export const DiagnosticResultSchema = z.object({
  causes: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        /** 0–100. How well the facts given pin this cause down. */
        confidence: z.number().min(0).max(100),
        explanation: z.string().max(600),
        /** Which of the given facts point here — codes, symptom words. */
        supporting: z.array(z.string().max(80)).max(8),
      }),
    )
    .min(1)
    .max(5),
  /** Cheapest, fastest checks first. What the tech does next, in order. */
  testPlan: z.array(z.string().max(200)).max(10),
  warnings: z.array(z.string().max(300)).max(6),
});

export type DiagnosticResult = z.infer<typeof DiagnosticResultSchema>;
export type DiagnosticCause = DiagnosticResult["causes"][number];

export interface DiagnosticInput {
  /** Upper-cased, de-duplicated, e.g. ["P0301", "P0171"]. */
  codes: string[];
  symptoms: string | null;
  observations: string | null;
  /** "2015 Chevrolet Sonic LT" — helps the model with known patterns. */
  vehicle: string | null;
  mileage: number | null;
  /** The customer's complaint, in their words. */
  complaint: string | null;
}

export interface DiagnosticOutcome {
  result: DiagnosticResult;
  source: "openai" | "fallback";
  model?: string;
}

/** "p0301, P0171 p0420" → ["P0301", "P0171", "P0420"]. Anything that isn't a code is dropped. */
export function parseCodes(raw: string): string[] {
  const seen = new Set<string>();
  for (const token of raw.toUpperCase().split(/[\s,;/]+/)) {
    if (/^[PBCU][0-9A-F]{4}$/.test(token)) seen.add(token);
  }
  return [...seen];
}

export function isObdCode(token: string): boolean {
  return /^[PBCU][0-9A-F]{4}$/i.test(token);
}

// -----------------------------------------------------------------------------
// The fallback: code families
// -----------------------------------------------------------------------------

interface Rule {
  /** Which codes this rule speaks to. */
  match: (code: string) => boolean;
  causes: (code: string) => Omit<DiagnosticCause, "supporting">[];
  tests: (code: string) => string[];
  warnings?: (code: string) => string[];
}

const cylinderOf = (code: string) => Number(code.slice(3));

/**
 * The families, most specific first. A code only feeds the first rule that
 * claims it, so P0301 is a cylinder misfire and never also "an unknown P
 * code". Confidence is the honest prior for that code alone; the symptom
 * pass below nudges it when the words agree.
 */
const RULES: Rule[] = [
  {
    // P0300: random / multiple cylinder misfire.
    match: (c) => c === "P0300",
    causes: () => [
      {
        title: "Vacuum leak or unmetered air leaning all cylinders",
        confidence: 55,
        explanation:
          "A misfire that moves between cylinders is usually a mixture problem rather than one bad coil — unmetered air after the MAF is the common one.",
      },
      {
        title: "Worn spark plugs or weak ignition across the engine",
        confidence: 50,
        explanation: "Plugs at the end of their service life misfire under load on more than one cylinder.",
      },
      {
        title: "Low fuel pressure or a weak pump",
        confidence: 40,
        explanation: "Starved of fuel under load the whole engine stumbles, and the ECM logs it as random misfire.",
      },
      {
        title: "Base engine — compression, timing, or a stuck EGR",
        confidence: 25,
        explanation: "Less common, but a random misfire at idle with good fuel and spark points at the engine itself.",
      },
    ],
    tests: () => [
      "Read misfire counters per cylinder with the engine at idle and under load",
      "Check short- and long-term fuel trims at idle and 2,500 rpm",
      "Smoke test the intake for unmetered air",
      "Inspect plugs and gap; check plug age against the service history",
      "Check fuel pressure against specification, at idle and under load",
    ],
    warnings: () => [
      "A flashing check-engine light means an active misfire that can overheat the catalytic converter — advise the customer not to drive it far.",
    ],
  },
  {
    // P0301–P0312: a named cylinder.
    match: (c) => /^P03(0[1-9]|1[0-2])$/.test(c),
    causes: (c) => {
      const cyl = cylinderOf(c);
      return [
        {
          title: `Failed ignition coil, cylinder ${cyl}`,
          confidence: 62,
          explanation: `A single-cylinder misfire is ignition first. Coil ${cyl} is the cheapest thing to swap and the most common cause.`,
        },
        {
          title: `Worn or fouled spark plug, cylinder ${cyl}`,
          confidence: 48,
          explanation: "A plug with a wide gap, oil fouling or a cracked insulator misfires on that cylinder alone.",
        },
        {
          title: `Clogged or leaking fuel injector, cylinder ${cyl}`,
          confidence: 32,
          explanation: "If the misfire stays put after coil and plug swaps, fuel delivery to that cylinder is next.",
        },
        {
          title: `Low compression on cylinder ${cyl}`,
          confidence: 18,
          explanation: "A burnt valve or worn rings misfires regardless of spark and fuel. Ruled out last because it costs the most to confirm.",
        },
      ];
    },
    tests: (c) => {
      const cyl = cylinderOf(c);
      const other = cyl === 1 ? 2 : 1;
      return [
        `Swap coil ${cyl} with coil ${other}, clear codes and drive — if the misfire moves, the coil is the fault`,
        `Pull plug ${cyl}, inspect and gap; compare against a neighbouring plug`,
        `Swap injector ${cyl} with a neighbour if the misfire stayed after the coil swap`,
        `Compression test cylinder ${cyl} if the misfire survives coil, plug and injector`,
      ];
    },
    warnings: () => [
      "A flashing check-engine light means an active misfire that can overheat the catalytic converter — advise the customer not to drive it far.",
    ],
  },
  {
    // P0171 / P0174: system too lean, bank 1 / bank 2.
    match: (c) => c === "P0171" || c === "P0174",
    causes: (c) => {
      const bank = c === "P0174" ? "bank 2" : "bank 1";
      return [
        {
          title: `Vacuum leak (unmetered air), ${bank}`,
          confidence: 60,
          explanation: "Positive long-term fuel trim at idle that settles off idle is the classic pattern for air getting in after the MAF.",
        },
        {
          title: "Contaminated or failing MAF sensor",
          confidence: 45,
          explanation: "A MAF reading low tells the ECM there is less air than there is, and it leans out both banks.",
        },
        {
          title: "Low fuel pressure",
          confidence: 35,
          explanation: "A weak pump or blocked filter leans the mixture most under load — trims that climb with rpm point here.",
        },
        {
          title: `Exhaust leak ahead of the ${bank} oxygen sensor`,
          confidence: 25,
          explanation: "Fresh air drawn in at a manifold crack reads as lean to the sensor even when the mixture is right.",
        },
      ];
    },
    tests: () => [
      "Record long-term fuel trim at idle and at 2,500 rpm — lean at idle only points at a vacuum leak, lean everywhere at the MAF or fuel supply",
      "Smoke test the intake, PCV system and brake booster hose",
      "Check MAF grams per second against expected for the displacement",
      "Check fuel pressure at idle and under load",
      "Listen for an exhaust leak at the manifold on a cold start",
    ],
  },
  {
    // P0172 / P0175: system too rich.
    match: (c) => c === "P0172" || c === "P0175",
    causes: () => [
      {
        title: "Leaking fuel injector or stuck-open purge valve",
        confidence: 50,
        explanation: "Extra fuel the ECM did not ask for drives trims negative, worst at idle.",
      },
      {
        title: "MAF over-reporting airflow",
        confidence: 40,
        explanation: "A MAF reading high makes the ECM add fuel for air that is not there.",
      },
      {
        title: "Failed fuel pressure regulator or a lazy oxygen sensor",
        confidence: 30,
        explanation: "High rail pressure or a sensor stuck reporting lean both end in a rich mixture.",
      },
    ],
    tests: () => [
      "Check fuel trims at idle and at 2,500 rpm",
      "Pull the vacuum line off the fuel pressure regulator and check for fuel",
      "Check MAF grams per second against expected",
      "Watch upstream O2 switching on the scan tool",
      "Inspect plugs for black sooty deposits",
    ],
  },
  {
    // P0420 / P0430: catalyst efficiency below threshold.
    match: (c) => c === "P0420" || c === "P0430",
    causes: (c) => {
      const bank = c === "P0430" ? "bank 2" : "bank 1";
      return [
        {
          title: `Catalytic converter degraded, ${bank}`,
          confidence: 55,
          explanation: "The rear oxygen sensor is switching like the front one, which means the catalyst is no longer storing oxygen.",
        },
        {
          title: `Exhaust leak between the converter and the ${bank} sensors`,
          confidence: 30,
          explanation: "A leak upstream of the rear sensor fools the efficiency test without the catalyst being bad.",
        },
        {
          title: "Rear oxygen sensor lazy or failing",
          confidence: 25,
          explanation: "Less common than a genuinely tired converter, but far cheaper — worth ruling out first.",
        },
        {
          title: "Upstream problem that poisoned the catalyst",
          confidence: 20,
          explanation: "A misfire, rich condition or oil consumption kills converters. Fix that first or the new one dies too.",
        },
      ];
    },
    tests: () => [
      "Compare front and rear O2 sensor waveforms at 2,000 rpm — a rear that mirrors the front is a tired catalyst",
      "Check for other stored codes (misfire, lean/rich, oil consumption) before condemning the converter",
      "Inspect the exhaust for leaks between the manifold and the rear sensor",
      "Check converter inlet vs outlet temperature under load",
    ],
    warnings: () => [
      "Replacing a catalytic converter without fixing what killed it is a repeat visit. Check for misfire and mixture codes first.",
    ],
  },
  {
    // P0440–P0457: evaporative emissions.
    match: (c) => /^P044[0-9]$|^P045[0-9]$/.test(c),
    causes: (c) => {
      const small = c === "P0456" || c === "P0442";
      return [
        {
          title: "Loose, worn or wrong fuel cap",
          confidence: small ? 55 : 45,
          explanation: "The cheapest and most common evap leak. Ask whether they fuelled up just before the light came on.",
        },
        {
          title: "Cracked evap hose or a leaking charcoal canister",
          confidence: 40,
          explanation: "Hoses harden and split; canisters crack where they mount. A smoke machine finds both.",
        },
        {
          title: "Purge or vent solenoid not sealing",
          confidence: 35,
          explanation: "A purge valve that leaks at rest also gives rough idle after refuelling; a vent valve stuck open fails the leak test.",
        },
      ];
    },
    tests: () => [
      "Inspect the fuel cap seal and confirm it clicks; replace if worn",
      "Smoke test the evap system with the vent valve commanded closed",
      "Command the purge valve on and off and check it holds vacuum",
      "Run the evap monitor with the scan tool after the repair to confirm",
    ],
  },
  {
    // P0128: coolant thermostat temperature below regulating temperature.
    match: (c) => c === "P0128",
    causes: () => [
      {
        title: "Thermostat stuck open",
        confidence: 65,
        explanation: "The engine never reaches operating temperature, or takes far too long — heater lukewarm in winter is the customer's usual complaint.",
      },
      {
        title: "Coolant temperature sensor reading low",
        confidence: 25,
        explanation: "A sensor with drifted resistance tells the ECM the engine is cold when it isn't.",
      },
      {
        title: "Low coolant level or a cooling fan running constantly",
        confidence: 20,
        explanation: "Either keeps the block from warming up. Both are visible on the first look under the hood.",
      },
    ],
    tests: () => [
      "Watch coolant temperature on the scan tool from a cold start — it should reach thermostat rating within 10–15 minutes",
      "Compare the coolant temperature sensor reading against an infrared thermometer at the housing",
      "Check coolant level and whether the fan runs with a cold engine",
    ],
  },
  {
    // P0401 / P0402 / P0404: EGR flow.
    match: (c) => /^P040[0-9]$/.test(c),
    causes: () => [
      {
        title: "EGR passages carboned up",
        confidence: 55,
        explanation: "Insufficient flow is almost always carbon in the passages or the valve seat, not the valve itself.",
      },
      {
        title: "EGR valve sticking or failed",
        confidence: 40,
        explanation: "A valve that will not open on command, or one stuck open, both set flow codes.",
      },
      {
        title: "Blocked or split EGR vacuum or electrical supply",
        confidence: 20,
        explanation: "Where the valve is vacuum operated, a hardened hose or failed solenoid keeps it shut.",
      },
    ],
    tests: () => [
      "Command the EGR valve open at idle with the scan tool — the engine should stumble or stall",
      "Remove the valve and inspect the passages for carbon",
      "Check the valve's position sensor sweeps smoothly",
    ],
  },
  {
    // P0100–P0104: MAF circuit.
    match: (c) => /^P010[0-4]$/.test(c),
    causes: () => [
      {
        title: "Dirty or failed mass airflow sensor",
        confidence: 55,
        explanation: "A contaminated element reads wrong; a failed one reads out of range and sets the circuit code outright.",
      },
      {
        title: "Air leak or damaged ducting between the MAF and the throttle",
        confidence: 35,
        explanation: "Air that bypasses the sensor makes its reading implausible for the engine load.",
      },
      {
        title: "Wiring or connector fault at the MAF",
        confidence: 25,
        explanation: "Corroded pins or a chafed harness give an intermittent circuit code that a sensor swap will not fix.",
      },
    ],
    tests: () => [
      "Inspect the intake ducting and clamps between the airbox and the throttle body",
      "Check MAF grams per second at idle against expected for the displacement",
      "Inspect the connector and wiring; wiggle test while watching live data",
      "Clean the element with MAF cleaner only, never brake cleaner",
    ],
  },
  {
    // P0335–P0349: crank and cam position sensors.
    match: (c) => /^P03[3-4][0-9]$/.test(c),
    causes: (c) => {
      const cam = /^P034/.test(c);
      const sensor = cam ? "camshaft position sensor" : "crankshaft position sensor";
      return [
        {
          title: `Failed ${sensor}`,
          confidence: 55,
          explanation: "These fail hot and recover cold — a stall that restarts after a rest is the classic story.",
        },
        {
          title: `Wiring, connector or reluctor damage at the ${sensor}`,
          confidence: 30,
          explanation: "Oil-soaked connectors and chafed harnesses set the same code as a dead sensor.",
        },
        {
          title: "Timing chain or belt stretched or jumped",
          confidence: 20,
          explanation: "Cam-to-crank correlation codes with a rattle on start-up point at timing, not the sensor.",
        },
      ];
    },
    tests: () => [
      "Scope the sensor signal cranking and at idle; check for dropouts when hot",
      "Inspect the connector and harness for oil intrusion and chafing",
      "Check cam and crank correlation on the scan tool against specification",
    ],
    warnings: () => [
      "A crank sensor that drops out while driving stalls the engine with no warning — treat as urgent.",
    ],
  },
  {
    // P0500–P0509: vehicle speed and idle control.
    match: (c) => /^P050[0-9]$/.test(c),
    causes: (c) => {
      const speed = /^P050[0-3]$/.test(c);
      return speed
        ? [
            {
              title: "Vehicle speed sensor or its wiring",
              confidence: 55,
              explanation: "Speedometer drops, harsh shifts and cruise cutting out usually accompany it.",
            },
            {
              title: "Wheel speed sensor or tone ring feeding the speed signal",
              confidence: 30,
              explanation: "On many cars the ECM takes vehicle speed from ABS; a bad wheel sensor sets this code too.",
            },
          ]
        : [
            {
              title: "Throttle body or idle air passage carboned up",
              confidence: 55,
              explanation: "Idle that surges, hangs high or dips low after cleaning nothing else — carbon restricting the idle air path.",
            },
            {
              title: "Vacuum leak raising the idle",
              confidence: 35,
              explanation: "Idle above target that the ECM cannot pull down is unmetered air.",
            },
            {
              title: "Idle air control valve or throttle actuator sticking",
              confidence: 30,
              explanation: "Where one is fitted, a sticking valve gives idle the ECM cannot control.",
            },
          ];
    },
    tests: (c) =>
      /^P050[0-3]$/.test(c)
        ? [
            "Compare vehicle speed on the scan tool against GPS on a road test",
            "Check the speed sensor signal and wiring at the transmission",
            "Read ABS codes for a wheel speed sensor fault",
          ]
        : [
            "Compare commanded and actual idle rpm on the scan tool",
            "Inspect and clean the throttle body and idle air passages",
            "Smoke test the intake for vacuum leaks",
            "Perform an idle relearn after cleaning",
          ],
  },
  {
    // P0700–P0799: transmission.
    match: (c) => /^P07[0-9A-F]{2}$/.test(c),
    causes: () => [
      {
        title: "Transmission fluid low, burnt or overdue",
        confidence: 45,
        explanation: "The first thing to check on any transmission code. Level and condition tell most of the story.",
      },
      {
        title: "Shift or pressure control solenoid fault",
        confidence: 40,
        explanation: "Ratio and solenoid codes come from the valve body; often electrical, sometimes mechanical.",
      },
      {
        title: "Transmission control module or wiring fault",
        confidence: 25,
        explanation: "P0700 on its own is only a request to read the TCM — the real code lives there.",
      },
    ],
    tests: () => [
      "Read the transmission control module for its own stored codes — P0700 is only a pointer",
      "Check fluid level and condition at operating temperature",
      "Record line pressure and shift timing on a road test",
      "Inspect the harness and connector at the transmission",
    ],
  },
  {
    // P0110–P0129: air and coolant temperature, throttle position, manifold pressure sensors.
    match: (c) => /^P01[1-2][0-9]$/.test(c),
    causes: (c) => {
      const family = /^P011/.test(c)
        ? "intake air or coolant temperature sensor"
        : /^P012[0-4]$/.test(c) || /^P022/.test(c)
          ? "throttle position sensor"
          : "sensor named by the code";
      return [
        {
          title: `Failed ${family}`,
          confidence: 50,
          explanation: "Circuit-range codes are usually the sensor itself once the wiring checks out.",
        },
        {
          title: `Wiring, connector or ground fault at the ${family}`,
          confidence: 35,
          explanation: "An open or a poor ground reads as out of range. Cheaper to rule out than the part.",
        },
      ];
    },
    tests: () => [
      "Compare the sensor's live reading against a known-good reference",
      "Check the 5V reference, signal and ground at the connector",
      "Wiggle test the harness while watching live data",
    ],
  },
  {
    // P0130–P0167: oxygen sensors.
    match: (c) => /^P01[3-6][0-9]$/.test(c),
    causes: () => [
      {
        title: "Oxygen sensor slow, lazy or failed",
        confidence: 50,
        explanation: "Sensors age out; response-time codes especially point at the sensor itself.",
      },
      {
        title: "Sensor heater circuit open or fuse blown",
        confidence: 35,
        explanation: "Heater codes are wiring and fuses as often as the element.",
      },
      {
        title: "Exhaust leak or mixture problem upstream of the sensor",
        confidence: 25,
        explanation: "A sensor can be reporting the truth about a leak; check trims before condemning it.",
      },
    ],
    tests: () => [
      "Watch the sensor's switching on the scan tool at 2,000 rpm",
      "Check the heater fuse and the circuit resistance",
      "Inspect the exhaust for leaks upstream of the sensor",
    ],
  },
  {
    // Anything else in the P0/P2 powertrain range: generic.
    match: (c) => c.startsWith("P"),
    causes: (c) => [
      {
        title: `Component or circuit named by ${c}`,
        confidence: 40,
        explanation: `${c} is outside the common families. Look the definition up for this make and start with the sensor or actuator it names, then its wiring.`,
      },
      {
        title: "Wiring, connector or ground fault in that circuit",
        confidence: 30,
        explanation: "Most one-off powertrain codes are an electrical fault rather than a dead part.",
      },
    ],
    tests: (c) => [
      `Look up ${c} for this make and model — manufacturer-specific definitions differ from generic ones`,
      "Check for technical service bulletins on the code and symptom",
      "Verify power, ground and signal at the named component",
    ],
  },
  {
    // C: chassis — ABS, traction, stability.
    match: (c) => c.startsWith("C"),
    causes: () => [
      {
        title: "Wheel speed sensor or tone ring fault",
        confidence: 50,
        explanation: "The most common chassis code by a distance: a cracked tone ring, a debris-packed sensor or a chafed lead.",
      },
      {
        title: "ABS or stability module, pump or wiring",
        confidence: 30,
        explanation: "Module and pump codes follow once the four wheel sensors read clean.",
      },
      {
        title: "Steering angle or yaw sensor out of calibration",
        confidence: 20,
        explanation: "Common after an alignment or a battery disconnect; a recalibration rather than a part.",
      },
    ],
    tests: () => [
      "Read all four wheel speeds on the scan tool while driving and watch for one that drops out",
      "Inspect the tone rings and sensor tips at each wheel",
      "Check the ABS module connector and grounds",
      "Recalibrate the steering angle sensor if the code names it",
    ],
    warnings: () => [
      "With an ABS or stability fault stored those systems may be switched off — braking still works, but tell the customer.",
    ],
  },
  {
    // B: body — modules, airbags, lighting, HVAC.
    match: (c) => c.startsWith("B"),
    causes: () => [
      {
        title: "Open circuit, connector or ground in the body system named",
        confidence: 45,
        explanation: "Body codes are overwhelmingly wiring and connectors: seat, door and airbag harnesses flex every day.",
      },
      {
        title: "Failed switch, sensor or actuator in that system",
        confidence: 35,
        explanation: "The component itself, once the wiring to it is proven.",
      },
    ],
    tests: () => [
      "Look the code up for this make — body codes are manufacturer-specific",
      "Inspect connectors under seats and at door jambs for corrosion or damage",
      "Check the circuit's fuse, power and ground at the module",
    ],
    warnings: () => [
      "If the code is in the airbag system, the airbags may be disabled until it is cleared — treat as a safety item.",
    ],
  },
  {
    // U: network.
    match: (c) => c.startsWith("U"),
    causes: () => [
      {
        title: "Lost communication with a module — power, ground or the module itself",
        confidence: 45,
        explanation: "A U-code names a module the others cannot hear. Nine times in ten it has lost power or ground.",
      },
      {
        title: "CAN bus wiring fault — chafed pair, corroded connector, water in a splice",
        confidence: 35,
        explanation: "A damaged bus takes several modules offline at once and sets a cluster of U-codes.",
      },
      {
        title: "Low battery voltage during a start",
        confidence: 20,
        explanation: "A weak battery drops modules off the bus while cranking and leaves history codes behind.",
      },
    ],
    tests: () => [
      "Note which modules set the code and which module is missing — the pattern locates the fault",
      "Check power and ground at the missing module's connector",
      "Measure CAN high and low resistance at the diagnostic connector (about 60 ohms with the battery disconnected)",
      "Load test the battery and check charging voltage",
    ],
  },
];

// -----------------------------------------------------------------------------
// The fallback: symptom words
// -----------------------------------------------------------------------------

interface SymptomRule {
  words: RegExp;
  label: string;
  /** Cause titles this symptom agrees with; each gets a nudge and a supporting fact. */
  agrees: RegExp[];
  causes: Omit<DiagnosticCause, "supporting">[];
  tests: string[];
  warnings?: string[];
}

const SYMPTOM_RULES: SymptomRule[] = [
  {
    words: /\b(misfir|rough idle|shak|shudder|stumbl|flashing)/i,
    label: "Misfire or rough idle",
    agrees: [/coil/i, /plug/i, /injector/i, /vacuum leak/i],
    causes: [
      {
        title: "Engine misfire — ignition, fuel or unmetered air",
        confidence: 45,
        explanation: "Shaking at idle that smooths out with revs is a misfire or a lean idle; the codes, if any, say which cylinder.",
      },
    ],
    tests: ["Read misfire counters per cylinder", "Check fuel trims at idle"],
  },
  {
    words: /\b(squeal|squeak|grind|brake|pedal|pulsat)/i,
    label: "Brake noise or pedal feel",
    agrees: [/brake/i],
    causes: [
      {
        title: "Brake pads worn to the wear indicator or rotors scored",
        confidence: 55,
        explanation: "A squeal under light braking is the wear tab; a grind means metal on metal.",
      },
      {
        title: "Warped rotors or a sticking caliper",
        confidence: 35,
        explanation: "Pulsation through the pedal is rotor runout; a pull or a hot wheel is a caliper.",
      },
    ],
    tests: [
      "Measure pad thickness and rotor thickness against minimum at all four corners",
      "Check for a dragging caliper — wheel temperature after a road test",
      "Check brake fluid level and condition",
    ],
    warnings: ["Grinding brakes are a safety item — do not release the car without confirming pad and rotor condition."],
  },
  {
    words: /\b(clunk|knock|rattle|bump|bang|creak)/i,
    label: "Suspension noise",
    agrees: [/sway bar|strut|shock|bushing|control arm/i],
    causes: [
      {
        title: "Worn sway bar end links or bushings",
        confidence: 55,
        explanation: "A clunk over small bumps at low speed, from one corner, is the end links nine times in ten.",
      },
      {
        title: "Worn strut mount, ball joint or control arm bushing",
        confidence: 40,
        explanation: "A deeper knock under braking or on turning points at the mount or the joint.",
      },
    ],
    tests: [
      "Bounce test and pry bar check of end links, ball joints and bushings on the lift",
      "Check strut mounts for play while turning the wheel lock to lock",
      "Road test over a speed bump to localise the corner",
    ],
    warnings: ["A loose ball joint or tie rod can separate — inspect before the car goes back out."],
  },
  {
    words: /\b(stall|hesitat|surg|dies|cuts? out)/i,
    label: "Stalling or hesitation",
    agrees: [/throttle body/i, /MAF/i, /vacuum leak/i, /fuel pressure/i, /crankshaft position/i],
    causes: [
      {
        title: "Dirty throttle body or idle air passage",
        confidence: 45,
        explanation: "Stalling at stops after a cold start, and hesitation pulling away, is carbon restricting idle air.",
      },
      {
        title: "Weak fuel delivery or a failing airflow sensor",
        confidence: 40,
        explanation: "Hesitation under load with clean idle points at fuel pressure or MAF.",
      },
      {
        title: "Crankshaft position sensor dropping out when hot",
        confidence: 30,
        explanation: "Stalls that restart after a few minutes' rest are the classic hot-sensor failure.",
      },
    ],
    tests: [
      "Inspect and clean the throttle body; perform an idle relearn",
      "Check fuel pressure and MAF reading under load",
      "Check for crank sensor dropouts on a scope once hot",
    ],
  },
  {
    words: /\b(overheat|temperature|hot|coolant|steam)/i,
    label: "Overheating or coolant",
    agrees: [/thermostat/i, /coolant/i],
    causes: [
      {
        title: "Thermostat stuck closed, low coolant or a cooling fan not running",
        confidence: 50,
        explanation: "The three causes of most overheating complaints, in the order they are cheapest to confirm.",
      },
      {
        title: "Water pump, radiator or a head gasket letting combustion into the coolant",
        confidence: 30,
        explanation: "Overheating with coolant loss and no external leak is the expensive branch — confirm before quoting.",
      },
    ],
    tests: [
      "Check coolant level, pressure test the system and look for external leaks",
      "Confirm the fan runs at temperature and with the A/C on",
      "Block test for combustion gases in the coolant",
    ],
    warnings: ["Do not run an engine that is overheating — a warped head turns a thermostat job into an engine job."],
  },
  {
    words: /\b(no.?start|won'?t start|crank|click|dead|slow start)/i,
    label: "No start or slow crank",
    agrees: [/battery/i, /starter/i, /crankshaft position/i],
    causes: [
      {
        title: "Battery weak, or corroded terminals and grounds",
        confidence: 55,
        explanation: "A click with no crank, or a slow crank, is the battery or its connections before anything else.",
      },
      {
        title: "Starter motor or solenoid",
        confidence: 35,
        explanation: "Battery tests good and there is voltage at the solenoid but no crank — the starter.",
      },
      {
        title: "Cranks but no start — fuel, spark or crank sensor",
        confidence: 30,
        explanation: "If it turns over without catching, check for spark and fuel pressure, then the crank signal.",
      },
    ],
    tests: [
      "Load test the battery and check terminal voltage drop while cranking",
      "Check voltage at the starter solenoid when the key is turned",
      "Check for spark, fuel pressure and an rpm signal on the scan tool while cranking",
    ],
  },
  {
    words: /\b(smell|burning|burnt|odou?r)/i,
    label: "Burning smell",
    agrees: [/oil/i, /brake/i, /clutch/i],
    causes: [
      {
        title: "Oil or coolant leaking onto the exhaust",
        confidence: 45,
        explanation: "A burning-oil smell after driving is a valve cover or oil filter housing leak dripping on the manifold.",
      },
      {
        title: "Dragging brake or slipping clutch",
        confidence: 35,
        explanation: "An acrid smell from one wheel is a sticking caliper; from the middle of the car on hills, the clutch.",
      },
    ],
    tests: [
      "Inspect the exhaust manifold and downpipe for fresh oil or coolant",
      "Check wheel temperatures after a road test",
    ],
  },
  {
    words: /\b(smoke|smoking)/i,
    label: "Smoke from the exhaust",
    agrees: [/oil/i, /injector/i, /head gasket/i],
    causes: [
      {
        title: "Blue smoke — oil consumption past valve seals or rings",
        confidence: 40,
        explanation: "Blue on start-up is valve seals; blue under load is rings or a turbo seal.",
      },
      {
        title: "White smoke — coolant entering the combustion chamber",
        confidence: 35,
        explanation: "Sweet-smelling white smoke that does not clear when warm is a head gasket or cracked head.",
      },
      {
        title: "Black smoke — running rich",
        confidence: 30,
        explanation: "Too much fuel: a leaking injector, high fuel pressure or a bad airflow reading.",
      },
    ],
    tests: [
      "Note the colour and when it appears — start-up, idle, under load",
      "Check oil and coolant levels and condition",
      "Block test the coolant for combustion gases if white",
    ],
  },
  {
    words: /\b(vibrat|wobble|pull|drift|shimmy)/i,
    label: "Vibration or pulling",
    agrees: [/rotor/i, /tire/i, /alignment/i],
    causes: [
      {
        title: "Tire balance, a separated tire or a bent wheel",
        confidence: 50,
        explanation: "Vibration that changes with road speed, not engine speed, is in the wheels and tires.",
      },
      {
        title: "Alignment out or a dragging brake causing a pull",
        confidence: 40,
        explanation: "A steady pull is alignment or tire pressure; a pull under braking is a caliper or a collapsed hose.",
      },
      {
        title: "Worn CV joint or driveshaft",
        confidence: 25,
        explanation: "Vibration under acceleration only, or a click on turns, is the driveline.",
      },
    ],
    tests: [
      "Inspect tires for wear pattern, damage and pressure; road-force balance",
      "Check alignment and look for a dragging brake",
      "Inspect CV boots and joints for play",
    ],
  },
  {
    words: /\b(leak|puddle|drip|dripping)/i,
    label: "Fluid leak",
    agrees: [/leak/i, /coolant/i, /oil/i],
    causes: [
      {
        title: "Oil, coolant, transmission or power steering leak — identify by colour and location",
        confidence: 45,
        explanation: "Brown or black is oil; green, orange or pink is coolant; red is transmission or power steering; clear is usually A/C condensate.",
      },
    ],
    tests: [
      "Clean the area, add dye if needed, run to temperature and find the highest wet point",
      "Check every fluid level and top up before the customer leaves",
    ],
  },
  {
    words: /\b(whine|hum|growl|groan|roar)/i,
    label: "Whine or hum",
    agrees: [/bearing/i, /power steering/i, /alternator/i],
    causes: [
      {
        title: "Wheel bearing — a hum or growl that changes with speed and cornering",
        confidence: 45,
        explanation: "Louder swinging one way than the other is a bearing on the loaded side.",
      },
      {
        title: "Power steering pump, alternator or an accessory bearing",
        confidence: 35,
        explanation: "A whine that follows engine speed and changes with steering or electrical load is on the belt.",
      },
    ],
    tests: [
      "Road test and note whether the noise follows road speed or engine speed",
      "Check each wheel for bearing play and roughness on the lift",
      "Stethoscope the accessories with the engine running",
    ],
  },
  {
    words: /\b(battery|dim|electrical|charging|alternator|warning light|dash light)/i,
    label: "Electrical or charging",
    agrees: [/battery/i, /alternator/i, /ground/i],
    causes: [
      {
        title: "Charging system — alternator output or a slipping belt",
        confidence: 45,
        explanation: "Dimming lights and a battery light are the alternator not keeping up.",
      },
      {
        title: "Battery at end of life or a parasitic drain",
        confidence: 40,
        explanation: "A battery that is flat every morning is either worn out or something is staying awake overnight.",
      },
      {
        title: "Corroded ground or a poor terminal connection",
        confidence: 30,
        explanation: "Flickering and odd warning lights are as often a ground as a module.",
      },
    ],
    tests: [
      "Load test the battery; check charging voltage at idle and 2,000 rpm with loads on",
      "Measure parasitic draw after the modules go to sleep",
      "Voltage-drop test the main grounds and battery cables",
    ],
  },
  {
    words: /\b(a\/c|air con|ac not|not cold|no heat|heater|blower|hvac)/i,
    label: "Heating or A/C",
    agrees: [/thermostat/i, /blend door/i, /refrigerant/i],
    causes: [
      {
        title: "Low refrigerant from a leak, or a compressor not engaging",
        confidence: 45,
        explanation: "A/C that is weak or warm is low charge first; a clutch that never clicks in is electrical or the compressor.",
      },
      {
        title: "Blend door actuator, blower resistor or a stuck thermostat",
        confidence: 40,
        explanation: "Heat on one side only or a blower with missing speeds are behind the dash; no heat with a cold engine is the thermostat.",
      },
    ],
    tests: [
      "Check static and running refrigerant pressures; dye the system if low",
      "Confirm compressor clutch engagement and command",
      "Check blower speeds and listen for the blend door actuator cycling",
    ],
  },
];

const NO_FACTS_RESULT: DiagnosticResult = {
  causes: [
    {
      title: "Needs a hands-on look before anything can be ranked",
      confidence: 20,
      explanation:
        "No codes and no symptom words to work from. Scan for stored and pending codes, road test to reproduce the complaint, and re-run this with what you find.",
      supporting: [],
    },
  ],
  testPlan: [
    "Scan all modules for stored, pending and history codes",
    "Road test with the customer's complaint in mind and try to reproduce it",
    "Check fluid levels and a quick visual under the hood and under the car",
  ],
  warnings: [VERIFICATION_WARNING],
};

/**
 * The deterministic path. Codes first, then symptom words, then the two
 * reconciled: a symptom that agrees with a code's cause raises that cause's
 * confidence rather than adding a duplicate. Sorted by confidence, capped at
 * five, tests de-duplicated in the order the causes suggested them.
 */
export function fallbackAnalysis(input: DiagnosticInput): DiagnosticResult {
  const causes = new Map<string, DiagnosticCause>();
  // Tests are collected per fact (a code, a symptom label) and ordered at the
  // end by how strongly that fact's causes ranked — so the coil swap for a
  // P0301 comes before the catalyst checks for a P0420 whatever order the
  // technician typed the codes in.
  const testGroups: { fact: string; tests: string[] }[] = [];
  const warnings: string[] = [];

  const addTests = (fact: string, list: string[]) => {
    testGroups.push({ fact, tests: list });
  };
  const addWarning = (warning: string) => {
    if (!warnings.includes(warning)) warnings.push(warning);
  };
  const addCause = (cause: Omit<DiagnosticCause, "supporting">, support: string) => {
    const key = cause.title.toLowerCase();
    const existing = causes.get(key);
    if (existing) {
      // A second fact pointing the same way is corroboration, not a new row.
      existing.confidence = Math.min(95, existing.confidence + 8);
      if (!existing.supporting.includes(support)) existing.supporting.push(support);
    } else {
      causes.set(key, { ...cause, supporting: [support] });
    }
  };

  for (const code of input.codes) {
    const rule = RULES.find((candidate) => candidate.match(code));
    if (!rule) continue;
    for (const cause of rule.causes(code)) addCause(cause, code);
    addTests(code, rule.tests(code));
    for (const warning of rule.warnings?.(code) ?? []) addWarning(warning);
  }

  // Two misfire codes together are more likely a shared cause than two coils.
  const misfires = input.codes.filter((code) => /^P03(0[1-9]|1[0-2])$/.test(code));
  if (misfires.length >= 2) {
    const fact = misfires.join(" + ");
    addCause(
      {
        title: "Shared cause behind multiple cylinder misfires — mixture, fuel supply or a common ignition fault",
        confidence: 50,
        explanation: `${misfires.join(", ")} together usually mean one problem reaching several cylinders — a vacuum leak, low fuel pressure or a shared coil pack — rather than several parts failing at once.`,
      },
      fact,
    );
    addTests(fact, ["Check fuel trims and fuel pressure before replacing more than one coil"]);
  }

  const words = [input.symptoms, input.observations, input.complaint].filter(Boolean).join(" ");
  for (const rule of SYMPTOM_RULES) {
    if (!rule.words.test(words)) continue;

    let agreed = false;
    for (const cause of causes.values()) {
      if (rule.agrees.some((pattern) => pattern.test(cause.title))) {
        cause.confidence = Math.min(95, cause.confidence + 10);
        if (!cause.supporting.includes(rule.label)) cause.supporting.push(rule.label);
        agreed = true;
      }
    }
    // Only add the symptom's own generic causes when no code already explains it.
    if (!agreed) {
      for (const cause of rule.causes) addCause(cause, rule.label);
    }
    addTests(rule.label, rule.tests);
    for (const warning of rule.warnings ?? []) addWarning(warning);
  }

  if (causes.size === 0) return NO_FACTS_RESULT;

  const ranked = [...causes.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map((cause) => ({ ...cause, confidence: Math.round(cause.confidence) }));

  // A fact's tests rank where its best cause ranked. A fact whose causes all
  // fell off the top five still gets its tests, after everything that made it.
  const weight = (fact: string) =>
    Math.max(
      0,
      ...[...causes.values()]
        .filter((cause) => cause.supporting.includes(fact))
        .map((cause) => cause.confidence),
    );
  const testPlan: string[] = [];
  for (const group of [...testGroups].sort((a, b) => weight(b.fact) - weight(a.fact))) {
    for (const test of group.tests) {
      if (!testPlan.includes(test)) testPlan.push(test);
    }
  }

  return {
    causes: ranked,
    testPlan: testPlan.slice(0, 10),
    warnings: [...warnings.slice(0, 5), VERIFICATION_WARNING],
  };
}

// -----------------------------------------------------------------------------
// The model path
// -----------------------------------------------------------------------------

const SYSTEM = [
  "You are a master automotive diagnostic technician helping a colleague at an independent repair shop.",
  "You are given OBD-II codes, the technician's symptoms and observations, and the customer's complaint.",
  "",
  "Rank the one to five most probable causes, most likely first. `confidence` is 0–100 and reflects how",
  "well the facts given pin that cause down — not how confident you sound. `supporting` lists which of",
  "the given codes or symptom words point at that cause; never list a fact you were not given.",
  "`testPlan` is what the technician should do next, in order, cheapest and fastest checks first — swap",
  "tests, smoke tests, live data, before anything that costs parts.",
  "`warnings` holds safety notes the shop should pass on (do not drive with a flashing light, brakes are",
  `a safety item). Make the last warning exactly: "${VERIFICATION_WARNING}"`,
  "",
  "Never name a price, a labour time or a part number. Never invent a code, a measurement or a symptom.",
].join("\n");

/**
 * Rank the causes. Never throws and never returns nothing: the model when it
 * is configured and behaves, the table when it isn't or doesn't. Whichever
 * answered, the result closes with the verification warning — appended in
 * code rather than trusted to the prompt.
 */
export async function analyze(input: DiagnosticInput): Promise<DiagnosticOutcome> {
  const completion = await structuredCompletion({
    name: "diagnostic_ranking",
    schema: DiagnosticResultSchema,
    system: SYSTEM,
    input: {
      vehicle: input.vehicle,
      mileage: input.mileage,
      codes: input.codes,
      symptoms: input.symptoms,
      observations: input.observations,
      complaint: input.complaint,
    },
  });

  if (!completion) {
    return { result: fallbackAnalysis(input), source: "fallback" };
  }

  const warnings = completion.data.warnings.filter((w) => w !== VERIFICATION_WARNING);
  return {
    result: {
      ...completion.data,
      causes: completion.data.causes.map((cause) => ({
        ...cause,
        confidence: Math.round(cause.confidence),
      })),
      warnings: [...warnings.slice(0, 5), VERIFICATION_WARNING],
    },
    source: "openai",
    model: completion.model,
  };
}
