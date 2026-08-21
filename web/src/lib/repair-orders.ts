/**
 * The statuses a ticket moves through, and what a human calls each one.
 *
 * Kept out of the actions file because a "use server" module may only export
 * async functions — a constant exported from one is a build error, not a
 * runtime surprise. Pages and forms need these strings too, so they live here
 * where both sides can import them.
 */

export const STATUSES = [
  "open",
  "awaiting_approval",
  "awaiting_parts",
  "in_progress",
  "ready",
  "closed",
  "cancelled",
] as const;

export type Status = (typeof STATUSES)[number];

/** Shop language, not database language. Nobody says "awaiting_parts" out loud. */
export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  awaiting_approval: "Needs approval",
  awaiting_parts: "Waiting on parts",
  in_progress: "On the lift",
  ready: "Ready",
  closed: "Closed",
  cancelled: "Cancelled",
};
