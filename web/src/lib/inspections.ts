import { INSPECTION_CATEGORIES, RATINGS, type Rating } from "./statuses";

/**
 * The digital inspection, as a set of rules rather than a set of rows.
 *
 * Thirteen systems, walked in the order a technician walks a car. Each one
 * becomes an `inspection_items` row when an inspection starts, and the
 * technician rates it green, yellow or red — or leaves it not inspected,
 * which is a real answer ("didn't get to the transmission, car left early")
 * and never counted against the car.
 *
 * No `server-only` here: the same vocabulary is read by the editor on the
 * client, the summary builder on the server and the unit tests.
 */

export type InspectionCategory = (typeof INSPECTION_CATEGORIES)[number];

export interface InspectionItemSpec {
  category: InspectionCategory;
  /** What the technician actually checks, so the card reads as a checklist. */
  name: string;
}

/**
 * The checklist. The names are what a competent multipoint sheet says; they
 * are stored on the item at start time so a later edit to this list never
 * rewrites an inspection that has already been signed.
 */
export const INSPECTION_ITEMS: readonly InspectionItemSpec[] = [
  { category: "Engine", name: "Oil level and condition, leaks, belts, hoses" },
  { category: "Transmission", name: "Fluid level and condition, leaks, mounts" },
  { category: "Brakes", name: "Pad and rotor thickness, lines, fluid" },
  { category: "Tires", name: "Tread depth, wear pattern, pressure" },
  { category: "Suspension", name: "Struts and shocks, control arms, bushings" },
  { category: "Steering", name: "Tie rods, rack, power steering fluid" },
  { category: "Battery", name: "Voltage, cold-cranking amps, terminals" },
  { category: "Fluids", name: "Coolant, brake, power steering, washer" },
  { category: "Lights", name: "Head, tail, brake, turn and licence lights" },
  { category: "Heating & A/C", name: "Cabin temperature, blower, cabin filter" },
  { category: "Exterior", name: "Wipers, glass, mirrors, body damage" },
  { category: "Interior", name: "Horn, seat belts, warning lights" },
  { category: "Safety", name: "Airbag light, ABS light, parking brake" },
];

/** Worse is higher. `not_inspected` is deliberately below green: silence is not a pass. */
const SEVERITY: Record<Rating, number> = {
  not_inspected: 0,
  green: 1,
  yellow: 2,
  red: 3,
};

export function isRating(value: string): value is Rating {
  return (RATINGS as readonly string[]).includes(value);
}

/**
 * The inspection's overall rating: the worst thing found. A car with twelve
 * greens and one red is a red — that one item is why the customer gets a
 * phone call. Nothing rated at all is `not_inspected`, never green.
 */
export function overallRating(ratings: readonly Rating[]): Rating {
  let worst: Rating = "not_inspected";
  for (const rating of ratings) {
    if (SEVERITY[rating] > SEVERITY[worst]) worst = rating;
  }
  return worst;
}

export interface RatingCounts {
  green: number;
  yellow: number;
  red: number;
  not_inspected: number;
}

export function countRatings(ratings: readonly Rating[]): RatingCounts {
  const counts: RatingCounts = { green: 0, yellow: 0, red: 0, not_inspected: 0 };
  for (const rating of ratings) counts[rating] += 1;
  return counts;
}

/** Items the technician actually looked at. The only ones a summary may mention. */
export function ratedOnly<T extends { rating: Rating }>(items: readonly T[]): T[] {
  return items.filter((item) => item.rating !== "not_inspected");
}

/**
 * "Brakes — front pads at 4mm (4 mm)": one item as a phrase a summary or a
 * follow-up can drop into a sentence. Notes first because they carry the
 * finding; the measurement rides along when it isn't already in the notes.
 */
export function describeItem(item: {
  category: string;
  notes?: string | null;
  measurement?: string | null;
}): string {
  const notes = item.notes?.trim();
  const measurement = item.measurement?.trim();
  const parts: string[] = [];
  if (notes) parts.push(notes);
  if (measurement && !mentions(notes, measurement)) parts.push(`(${measurement})`);
  return parts.length > 0 ? `${item.category} — ${parts.join(" ")}` : item.category;
}

/** "Front pads at 4mm" already says "4 mm" — spacing and case don't make it new information. */
function mentions(text: string | undefined, value: string): boolean {
  if (!text) return false;
  const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  return squash(text).includes(squash(value));
}

/**
 * The same finding, shaped for a sentence in a text message: "brakes (front
 * pads at 4mm)". Lower-case category, the finding in brackets, no dashes —
 * three of these joined with commas still read on a phone.
 */
export function phraseItem(item: {
  category: string;
  notes?: string | null;
  measurement?: string | null;
}): string {
  const notes = item.notes?.trim();
  const measurement = item.measurement?.trim();
  const finding = notes
    ? measurement && !mentions(notes, measurement)
      ? `${notes}, ${measurement}`
      : notes
    : measurement;
  const category = item.category.toLowerCase();
  return finding ? `${category} (${finding.charAt(0).toLowerCase()}${finding.slice(1)})` : category;
}

/** "a, b and c" — a list as a sentence reads it. */
export function joinForSentence(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
