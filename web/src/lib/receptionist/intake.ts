import { z } from "zod";

import { toE164 } from "../phone";
import { URGENCIES, type Urgency } from "../statuses";

/**
 * What ZOL takes down from a conversation.
 *
 * The intake is the bridge between talk and a booking: customer, phone,
 * vehicle, what's wrong, how urgent, when they'd like to come in. The model
 * extracts it when a key is configured; when it isn't — every local machine,
 * and any minute OpenAI is down — a deterministic parser does the same job
 * from keywords and is labelled `fallback` everywhere the result is shown.
 *
 * Nothing here diagnoses. `serviceType` is what kind of visit to book, not
 * what's wrong with the car; `safetyAdvice` is "don't drive it", never "it's
 * the alternator".
 *
 * No `server-only` in this file: the parser is pure and unit-tested with plain
 * node. The one call that needs a server module is loaded lazily inside
 * `extractIntake` so the import graph stays clean for the tests.
 */

export const IntakeSchema = z.object({
  customerName: z.string().nullable(),
  /** E.164, or null when the caller never gave one. */
  phone: z.string().nullable(),
  vehicle: z.object({
    year: z.number().int().nullable(),
    make: z.string().nullable(),
    model: z.string().nullable(),
  }),
  /** The caller's own words for the problem, cleaned up. */
  complaint: z.string().nullable(),
  symptoms: z.array(z.string()),
  urgency: z.enum(URGENCIES),
  /** What to book: "Brake service", "Check-engine diagnostic". */
  serviceType: z.string().nullable(),
  preferredTime: z.string().nullable(),
  /** One or two sentences for the call list and the advisor. */
  summary: z.string(),
  /** Only ever "stop driving" or "get it looked at soon" — never a diagnosis. */
  safetyAdvice: z.string().nullable(),
});

export type Intake = z.infer<typeof IntakeSchema>;

export interface TranscriptLine {
  role: "assistant" | "customer" | "system";
  content: string;
}

export type IntakeSource = "openai" | "fallback";

export function emptyIntake(): Intake {
  return {
    customerName: null,
    phone: null,
    vehicle: { year: null, make: null, model: null },
    complaint: null,
    symptoms: [],
    urgency: "routine",
    serviceType: null,
    preferredTime: null,
    summary: "",
    safetyAdvice: null,
  };
}

// -----------------------------------------------------------------------------
// Pieces of the deterministic parser, shared with the turn-by-turn fallback
// -----------------------------------------------------------------------------

/** Makes the parser knows, with the way people say them on the phone. */
const MAKES: [canonical: string, ...aliases: string[]][] = [
  ["Chevrolet", "chevrolet", "chevy"],
  ["Honda", "honda"],
  ["Toyota", "toyota"],
  ["Ford", "ford"],
  ["Jeep", "jeep"],
  ["Nissan", "nissan"],
  ["Subaru", "subaru"],
  ["Mazda", "mazda"],
  ["Volkswagen", "volkswagen", "vw"],
  ["Hyundai", "hyundai"],
  ["Kia", "kia"],
  ["BMW", "bmw"],
  ["Mercedes-Benz", "mercedes-benz", "mercedes", "benz"],
  ["Audi", "audi"],
  ["Dodge", "dodge"],
  ["Ram", "ram"],
  ["GMC", "gmc"],
  ["Buick", "buick"],
  ["Cadillac", "cadillac"],
  ["Lexus", "lexus"],
  ["Acura", "acura"],
  ["Tesla", "tesla"],
  ["Volvo", "volvo"],
  ["Chrysler", "chrysler"],
  ["Mitsubishi", "mitsubishi"],
  ["Infiniti", "infiniti"],
  ["Lincoln", "lincoln"],
  ["Mini", "mini cooper", "mini"],
  ["Porsche", "porsche"],
  ["Land Rover", "land rover", "range rover"],
  ["Jaguar", "jaguar"],
  ["Genesis", "genesis"],
  ["Pontiac", "pontiac"],
  ["Saturn", "saturn"],
  ["Scion", "scion"],
  ["Fiat", "fiat"],
];

/** Words that end a model name: "Sonic has the check engine light on". */
const MODEL_STOP = new Set([
  "has", "have", "had", "is", "was", "that", "which", "with", "and", "it", "its", "it's",
  "the", "my", "a", "an", "i", "in", "on", "for", "but", "when", "just", "started", "keeps",
  "won't", "wont", "doesn't", "makes", "making", "been", "there", "there's", "so", "or", "to",
  "about", "sometimes", "here", "again", "please", "thanks", "thank",
]);

export interface ParsedVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
}

function titleModel(raw: string): string {
  // CR-V, F-150, CX-5, Q5, RAV4, MX-5 — short, hyphenated or digit-bearing
  // model names are written in caps; Civic, Sonic, Escape are not.
  if (/^[a-z]{1,3}-?\d/i.test(raw) || /^[a-z]{1,2}-[a-z]{1,2}$/i.test(raw) || raw.length <= 3) {
    return raw.toUpperCase();
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function parseVehicle(text: string): ParsedVehicle {
  const lower = text.toLowerCase();
  let make: string | null = null;
  let model: string | null = null;
  let makeIndex = -1;

  for (const [canonical, ...aliases] of MAKES) {
    for (const alias of aliases) {
      const match = new RegExp(`\\b${alias.replace(/[-\s]/g, "[-\\s]?")}\\b`).exec(lower);
      if (match && (makeIndex === -1 || match.index < makeIndex)) {
        make = canonical;
        makeIndex = match.index;
        const after = text.slice(match.index + match[0].length).trim();
        const tokens = after.split(/[\s,.;!?]+/).filter(Boolean);
        const first = tokens[0];
        // A plausible model year is never a model name; "1500" and "F-150" are.
        const isYear = (token: string) => /^(19|20)\d{2}$/.test(token);
        if (first && !MODEL_STOP.has(first.toLowerCase()) && /^[a-z0-9-]+$/i.test(first) && !isYear(first)) {
          model = titleModel(first);
          // "Silverado 1500", "F-150 Lightning" — a second token that carries
          // digits is part of the name; a plain word is the start of the story.
          const second = tokens[1];
          if (second && /\d/.test(second) && /^[a-z0-9-]+$/i.test(second) && !isYear(second)) {
            model = `${model} ${second.toUpperCase()}`;
          }
        }
        break;
      }
    }
  }

  // The year nearest the make wins; otherwise the first plausible one.
  const years = [...text.matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)];
  let year: number | null = null;
  if (years.length > 0) {
    const pick =
      makeIndex >= 0
        ? years.reduce((best, m) =>
            Math.abs((m.index ?? 0) - makeIndex) < Math.abs((best.index ?? 0) - makeIndex) ? m : best,
          )
        : years[0];
    year = Number(pick[1]);
  }

  return { year, make, model };
}

export function parsePhone(text: string): string | null {
  const match = /(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})\b/.exec(text);
  if (!match) return null;
  return toE164(match[1]) ?? null;
}

const NAME_STOP = new Set([
  "calling", "and", "from", "with", "here", "again", "about", "i", "my", "the", "a", "an",
  "just", "so", "hi", "hello", "hey", "yeah", "yes", "um", "uh", "it's", "its", "at", "in",
  "on", "for", "but", "car", "truck", "vehicle", "phone", "number", "is", "was",
]);

function cleanName(words: string[]): string | null {
  const kept: string[] = [];
  for (const word of words) {
    const w = word.replace(/[^a-z'-]/gi, "");
    if (!w || NAME_STOP.has(w.toLowerCase())) break;
    if (parseVehicle(w).make) break;
    kept.push(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    if (kept.length === 3) break;
  }
  return kept.length > 0 ? kept.join(" ") : null;
}

/** "Hi, it's Jordan Lee. My 2015…" → "Jordan Lee". */
export function parseName(text: string): string | null {
  const match =
    /(?:my name is|my name's|name is|this is|it's|it is|i'm|i am|speaking with)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3})/i.exec(
      text,
    );
  if (!match) return null;
  return cleanName(match[1].split(/\s+/));
}

/**
 * When the last thing ZOL asked was "who am I speaking with", the whole
 * message is the answer. Accepts one to four name-shaped words and nothing
 * that reads as a phone number or a car.
 */
export function parseBareName(text: string): string | null {
  const direct = parseName(text);
  if (direct) return direct;
  const stripped = text.replace(/[.!,]/g, " ").trim();
  if (parsePhone(stripped) || parseVehicle(stripped).make) return null;
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;
  if (!words.every((w) => /^[a-z][a-z'-]*$/i.test(w))) return null;
  return cleanName(words);
}

// --- urgency -----------------------------------------------------------------

const STOP_DRIVING = [
  /\bflashing\b/,
  /\bsmok(e|ing)\b/,
  /\bon fire\b|\bfire\b/,
  /\bno brakes\b/,
  /\bbrakes? (fail|failed|failing|went out|gone|don'?t work|aren'?t working|not working)\b/,
  /\bpedal (goes|went|going|dropped) to the floor\b/,
  /\bcan'?t stop\b|\bwon'?t stop\b/,
  /\bsteering (locked|went out|is gone|stopped working)\b/,
  /\bwheel (fell|came|is coming) off\b/,
  /\bsteam\b|\bboiling over\b/,
  /\bstop driving\b|\bunsafe to drive\b|\bundriveable\b/,
];

const URGENT = [
  /\boverheat/,
  /\bstall(s|ed|ing)?\b/,
  /\bwon'?t start\b|\bnot starting\b|\bno start\b|\bdoesn'?t start\b/,
  /\bgrind(s|ing)?\b/,
  /\bleak(s|ing)?\b/,
  /\bsoft pedal\b|\bspongy\b|\bmushy\b|\bpedal (feels|is|seems|gets|has been)( a (bit|little))? (soft|spongy|mushy|low)\b/,
  /\bdies\b|\bdied\b|\bcuts out\b/,
  /\boil (light|pressure)\b/,
  /\bbattery light\b|\bcharging light\b/,
  /\bbrake light\b|\babs light\b/,
  /\bshak(es|ing) (badly|a lot|violently)\b/,
  /\btow\b/,
];

const SOON = [
  /\bcheck.?engine\b/,
  /\bsqueal|\bsqueak/,
  /\bnoise|\bclunk|\brattle|\bknock/,
  /\bvibrat|\bshak(es|ing|y)\b|\bwobbl/,
  /\bwarning light\b|\blight (is|came|comes) on\b/,
  /\bpull(s|ing)? to\b/,
  /\brough idle\b|\bhesitat|\bmisfir/,
  /\bweaker|\bloss of power|\bno power|\bsluggish/,
  /\bhard to start\b|\bclick(s|ing)?\b/,
  /\ba\/?c\b.*(not|isn'?t) (cold|working)|\bheat(er)? (not|isn'?t) working\b/,
  /\bslip(s|ping)\b|\bjerk(s|ing)?\b/,
];

/**
 * "No grinding, no smoke" must not read as grinding and smoke. Drops a
 * negated symptom and up to two words between the negation and it.
 */
export function scrubNegations(text: string): string {
  return text.replace(
    /\b(?:no|not|isn't|isnt|doesn't|doesnt|don't|dont|without|never|hasn't|hasnt|wasn't|wasnt)\s+(?:\w+\s+){0,2}?(?:grind\w*|smok\w*|leak\w*|overheat\w*|stall\w*|flash\w*|shak\w*|noise\w*|squeal\w*|click\w*|light\w*|steam\w*)/gi,
    " ",
  );
}

export function classifyUrgency(text: string): Urgency {
  const t = scrubNegations(text.toLowerCase());
  if (STOP_DRIVING.some((re) => re.test(t))) return "stop_driving";
  if (URGENT.some((re) => re.test(t))) return "urgent";
  if (SOON.some((re) => re.test(t))) return "soon";
  return "routine";
}

const URGENCY_RANK: Record<Urgency, number> = { routine: 0, soon: 1, urgent: 2, stop_driving: 3 };

export function maxUrgency(a: Urgency, b: Urgency): Urgency {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

// --- what to book -----------------------------------------------------------

const SERVICE_TYPES: [RegExp, string][] = [
  [/\bcheck.?engine\b|\bmisfir|\brough idle\b|\bhesitat|\bstall/, "Check-engine diagnostic"],
  [/\bbrake|\bsqueal|\bpedal\b/, "Brake service"],
  [/\bwon'?t start\b|\bnot starting\b|\bno start\b|\bclick(s|ing)?\b|\bbattery\b|\balternator\b|\belectrical\b|\blights? (dim|flicker)/, "Electrical diagnostic"],
  [/\boverheat|\bcoolant\b|\btemperature\b|\bradiator\b|\bsteam\b/, "Cooling system"],
  [/\boil (change|service)\b|\boil\b.*\bchange\b/, "Oil service"],
  [/\balignment\b|\bpull(s|ing)? to\b/, "Alignment"],
  [/\btire|\btyre|\bflat\b|\brotation\b/, "Tires"],
  [/\bclunk|\bbump|\bsuspension\b|\bshock|\bstrut|\bsteering\b/, "Suspension"],
  [/\ba\/?c\b|\bair condition|\bheater?\b/, "Heating & A/C"],
  [/\btransmission\b|\bslip(s|ping)\b|\bshift(s|ing)?\b/, "Transmission diagnostic"],
  [/\binspection\b|\bpre-?trip\b|\blook(ed)? over\b|\bsmog\b/, "Inspection"],
  [/\bmaintenance\b|\bservice\b|\btune.?up\b/, "Routine maintenance"],
  [/\bnoise|\brattle|\bknock|\bvibrat|\bshak/, "Noise & vibration diagnostic"],
];

export function serviceTypeFor(text: string): string | null {
  const t = text.toLowerCase();
  for (const [re, label] of SERVICE_TYPES) if (re.test(t)) return label;
  return null;
}

const SYMPTOMS: [RegExp, string][] = [
  [/\bcheck.?engine\b/, "Check-engine light"],
  [/\bflashing\b/, "Warning light flashing"],
  [/\brough idle\b|\bshak(es|ing|y)\b.*\b(idle|stopped|stop)\b/, "Rough idle"],
  [/\bstall/, "Stalling"],
  [/\bhesitat/, "Hesitation"],
  [/\bweaker|\bloss of power|\bno power|\bsluggish/, "Reduced power"],
  [/\bsqueal|\bsqueak/, "Squealing"],
  [/\bgrind/, "Grinding"],
  [/\bsoft pedal\b|\bspongy\b|\bmushy\b|\bpedal (feels|is|seems|gets|has been)( a (bit|little))? (soft|spongy|mushy|low)\b|\bpedal (travels|goes) (further|farther|down)/, "Soft brake pedal"],
  [/\bpull(s|ing)? to\b/, "Pulls to one side"],
  [/\bvibrat|\bwobbl|\bshak/, "Vibration"],
  [/\bclunk|\bknock/, "Clunking"],
  [/\brattle/, "Rattle"],
  [/\bwon'?t start\b|\bnot starting\b|\bno start\b|\bhard to start\b/, "Won't start"],
  [/\bclick(s|ing)?\b/, "Clicking on start"],
  [/\blights? (dim|flicker)/, "Lights dimming"],
  [/\boverheat|\btemperature\b/, "Overheating"],
  [/\bleak/, "Leak"],
  [/\bsmok(e|ing)\b/, "Smoke"],
  [/\bsteam\b/, "Steam"],
  [/\bwarning light\b|\bbattery light\b|\boil light\b|\babs light\b/, "Warning light"],
  [/\ba\/?c\b.*(not|isn'?t) (cold|working)/, "A/C not cold"],
];

export function symptomsIn(text: string): string[] {
  const t = scrubNegations(text.toLowerCase());
  const found: string[] = [];
  for (const [re, label] of SYMPTOMS) if (re.test(t) && !found.includes(label)) found.push(label);
  return found;
}

// --- when -------------------------------------------------------------------

const TIME_PHRASE =
  /\b((?:as soon as possible|asap|earliest(?: you have| available| you've got)?|first thing|whenever|any ?time|no preference)(?: (?:tomorrow|today|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday))?(?: (?:morning|afternoon|evening))?|(?:early |late |this |next )?(?:today|tomorrow|tonight|this week|next week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: (?:morning|afternoon|evening|at \d{1,2}(?::\d{2})?\s?(?:am|pm)?))?|(?:in the )?(?:morning|afternoon|evening)s?(?: (?:tomorrow|today|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday))?)\b/i;

/**
 * The time the caller asked for. Every time-shaped phrase is scored — a day
 * or "earliest" beats a bare "morning", and "this morning" is when the
 * problem happened, not when they want to come in — and ties go to the later
 * mention, because the booking is usually settled at the end of the call.
 */
export function parsePreferredTime(text: string): string | null {
  const matches = [...text.matchAll(new RegExp(TIME_PHRASE.source, "gi"))];
  let best: { phrase: string; score: number } | null = null;

  for (const match of matches) {
    const phrase = match[1].replace(/\s+/g, " ").trim();
    const lower = phrase.toLowerCase();
    const before = text.slice(Math.max(0, (match.index ?? 0) - 6), match.index).toLowerCase();
    let score = 0;
    if (/\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|next week|this week)\b/.test(lower)) score += 2;
    if (/\b(earliest|asap|as soon as possible|first thing|whenever|any ?time|no preference)\b/.test(lower)) score += 2;
    if (/^(?:in the )?(morning|afternoon|evening)s?$/.test(lower) && /\bthis\s*$/.test(before)) score -= 3;
    if (!best || score >= best.score) best = { phrase, score };
  }

  if (!best || best.score < 0) return null;
  return best.phrase.charAt(0).toUpperCase() + best.phrase.slice(1);
}

/** "whenever", "any time", "no preference" — the caller has no opinion. */
export function isNoPreference(text: string): boolean {
  return /\b(whenever|any ?time|anytime|no preference|doesn'?t matter|don'?t mind|whatever works|either|you pick|earliest|asap|as soon as)\b/i.test(
    text,
  );
}

// --- the complaint -----------------------------------------------------------

const PROBLEM_WORDS =
  /\b(light|noise|brake|start|stall|shak|vibrat|leak|overheat|smoke|squeal|grind|clunk|rattle|pull|check|engine|won'?t|doesn'?t|isn'?t|problem|issue|wrong|smell|rough|hesitat|slip|jerk|oil|tire|battery|click|weak|power|a\/?c|heat|coolant|temperature|service|inspection|maintenance|rotation|alignment)\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripIntro(sentence: string): string {
  return sentence
    .replace(/^(hi|hello|hey|yeah|yes|um|uh|so)[,!. ]+/i, "")
    .replace(/^(it's|this is|my name is|i'm|i am)\s+[a-z][a-z'-]*(\s+[a-z][a-z'-]*){0,2}[,.]?\s*/i, "")
    .trim();
}

export function complaintFrom(customerLines: string[]): string | null {
  for (const line of customerLines) {
    for (const sentence of sentences(line)) {
      const cleaned = stripIntro(sentence);
      if (cleaned.length >= 8 && PROBLEM_WORDS.test(cleaned) && !/^\+?\(?\d/.test(cleaned)) {
        return cleaned.slice(0, 240);
      }
    }
  }
  const first = customerLines.map((l) => stripIntro(l)).find((l) => l.length >= 8);
  return first ? first.slice(0, 240) : null;
}

// --- safety and summary ------------------------------------------------------

export function safetyAdviceFor(urgency: Urgency, text: string): string | null {
  const t = text.toLowerCase();
  if (urgency === "stop_driving") {
    if (/brake|pedal|stop/.test(t)) {
      return "Please don't drive it. If the brakes aren't stopping the car reliably, have it towed in — the shop can arrange that.";
    }
    if (/smok|fire|steam|overheat/.test(t)) {
      return "Please pull over somewhere safe and don't keep driving it. Smoke or steam from the engine bay is a stop-now situation.";
    }
    return "Please don't drive it. A flashing warning light means stop and have it towed in rather than risk further damage.";
  }
  if (urgency === "urgent") {
    return "Keep the trips short until it's seen. If it gets worse, or a light starts flashing, stop driving it and call the shop.";
  }
  if (urgency === "soon" && /check.?engine/.test(t)) {
    return "A steady check-engine light is safe to drive on for now. If it starts flashing or the car loses power, stop driving it.";
  }
  return null;
}

export function vehicleWords(v: ParsedVehicle): string | null {
  const label = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return label.length > 0 ? label : null;
}

export function summarize(intake: Omit<Intake, "summary">, opts: { returning?: boolean } = {}): string {
  const who = intake.customerName ?? "Caller";
  const car = vehicleWords(intake.vehicle) ?? "an unidentified vehicle";
  const what = intake.complaint ? intake.complaint.replace(/\.$/, "") : "no specific complaint";
  const when = intake.preferredTime ? ` Asked for ${intake.preferredTime.toLowerCase()}.` : "";
  const urgency =
    intake.urgency === "stop_driving"
      ? " Advised not to drive it."
      : intake.urgency === "urgent"
        ? " Sounds urgent."
        : "";
  return `${opts.returning ? "Returning customer " : ""}${who}: ${car} — ${what}.${when}${urgency}`.replace(/\s+/g, " ");
}

// -----------------------------------------------------------------------------
// The parser
// -----------------------------------------------------------------------------

export interface KnownFacts {
  /** What the turn-by-turn conversation already established, question by question. */
  customerName?: string | null;
  phone?: string | null;
  vehicle?: Partial<ParsedVehicle> | null;
  complaint?: string | null;
  preferredTime?: string | null;
  urgency?: Urgency | null;
  serviceType?: string | null;
  symptoms?: string[] | null;
  returning?: boolean;
}

/**
 * The deterministic extractor. Reads only what the customer said — an
 * assistant line like "I have your Sonic on file" must not put a Sonic in the
 * intake of a caller who's ringing about their Civic.
 *
 * Facts the conversation established explicitly (`known`) win over anything
 * inferred from the whole transcript, because "what's the vehicle?" → "2012
 * Honda Civic" is a better source than a regex over four minutes of talk.
 */
export function parseIntakeFallback(transcript: TranscriptLine[], known: KnownFacts = {}): Intake {
  const customerLines = transcript.filter((l) => l.role === "customer").map((l) => l.content);
  const said = customerLines.join(" \n ");

  const parsedVehicle = parseVehicle(said);
  const vehicle: ParsedVehicle = {
    year: known.vehicle?.year ?? parsedVehicle.year,
    make: known.vehicle?.make ?? parsedVehicle.make,
    model: known.vehicle?.model ?? parsedVehicle.model,
  };
  // A year with no make is a year from a story, not a vehicle.
  if (!vehicle.make) vehicle.year = known.vehicle?.year ?? null;

  const complaint = known.complaint ?? complaintFrom(customerLines);
  const urgency = maxUrgency(known.urgency ?? "routine", classifyUrgency(said));
  const symptoms = Array.from(new Set([...(known.symptoms ?? []), ...symptomsIn(said)]));
  const serviceType = known.serviceType ?? serviceTypeFor(said) ?? (complaint ? "General diagnostic" : null);

  const draft: Omit<Intake, "summary"> = {
    customerName: known.customerName ?? parseName(said),
    phone: known.phone ?? parsePhone(said),
    vehicle,
    complaint,
    symptoms,
    urgency,
    serviceType,
    preferredTime: known.preferredTime ?? parsePreferredTime(said),
    safetyAdvice: safetyAdviceFor(urgency, said),
  };

  return { ...draft, summary: summarize(draft, { returning: known.returning }) };
}

// -----------------------------------------------------------------------------
// Extraction: the model when there is one, the parser when there isn't
// -----------------------------------------------------------------------------

const SYSTEM = [
  "You are the intake clerk for an independent auto repair shop, reading the transcript of a conversation between the shop's receptionist (assistant) and a caller (customer).",
  "Extract only what the customer actually said. Never infer a diagnosis; `serviceType` is the kind of visit to book, `safetyAdvice` is at most 'stop driving' or 'get it looked at soon'.",
  "Urgency: stop_driving for flashing lights, smoke, brake failure or anything unsafe; urgent for overheating, stalling, no-start, grinding, leaks; soon for warning lights, noises, vibration; routine for maintenance.",
  "Phone numbers in E.164 (+1XXXXXXXXXX). Vehicle year as a number. Null for anything the customer didn't say.",
  "`summary` is one or two plain sentences an advisor reads before calling back.",
].join("\n");

/**
 * The intake for a finished conversation, and where it came from.
 *
 * Facts the turn-by-turn engine collected are passed as `known` and applied
 * on top of whichever extractor ran: explicit answers to explicit questions
 * beat both a regex and a language model reading between the lines.
 */
export async function extractIntake(
  transcript: TranscriptLine[],
  known: KnownFacts = {},
): Promise<{ intake: Intake; source: IntakeSource }> {
  const fallback = parseIntakeFallback(transcript, known);

  // Lazy: lib/ai/client.ts is server-only, and this module's parser has to
  // stay importable from a plain node test.
  const { structuredCompletion } = await import("../ai/client");
  const result = await structuredCompletion({
    name: "receptionist_intake",
    schema: IntakeSchema,
    system: SYSTEM,
    input: { transcript, alreadyEstablished: known },
    temperature: 0.1,
  });

  if (!result) return { intake: fallback, source: "fallback" };

  const ai = result.data;
  const phone = ai.phone ? (toE164(ai.phone) ?? null) : null;
  const intake: Intake = {
    ...ai,
    customerName: known.customerName ?? ai.customerName ?? fallback.customerName,
    phone: known.phone ?? phone ?? fallback.phone,
    vehicle: {
      year: known.vehicle?.year ?? ai.vehicle.year ?? fallback.vehicle.year,
      make: known.vehicle?.make ?? ai.vehicle.make ?? fallback.vehicle.make,
      model: known.vehicle?.model ?? ai.vehicle.model ?? fallback.vehicle.model,
    },
    complaint: known.complaint ?? ai.complaint ?? fallback.complaint,
    preferredTime: known.preferredTime ?? ai.preferredTime ?? fallback.preferredTime,
    // The keyword classifier is a floor: a model that calls "no brakes"
    // routine does not get the last word on safety.
    urgency: maxUrgency(ai.urgency, fallback.urgency),
    serviceType: ai.serviceType ?? fallback.serviceType,
    symptoms: ai.symptoms.length > 0 ? ai.symptoms : fallback.symptoms,
    summary: ai.summary || fallback.summary,
    safetyAdvice: ai.safetyAdvice ?? fallback.safetyAdvice,
  };

  return { intake, source: "openai" };
}
