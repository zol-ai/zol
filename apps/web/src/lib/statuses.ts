/**
 * Every status vocabulary in the product, with what a human calls each value
 * and how the badge for it is coloured.
 *
 * One file, and deliberately no `server-only`: the same strings are typed by
 * server actions, checked by Postgres, rendered by client forms and read by
 * the badge component, and three copies of "awaiting_parts means Waiting on
 * parts" is two too many. Database CHECK constraints in db/migrations repeat
 * these lists — that third copy is Postgres refusing a value the code has
 * never heard of, which is worth having.
 *
 * Tones follow the app's one colour system. Emerald ("zol") is something ZOL
 * finished or a state that's good news; amber ("person") is a state waiting
 * on a human; the rest are neutral shades that just tell columns apart.
 */

export type Tone = "zol" | "person" | "neutral" | "blue" | "violet" | "red";

export interface Badge {
  label: string;
  tone: Tone;
}

// -----------------------------------------------------------------------------
// Repair orders
// -----------------------------------------------------------------------------

export const RO_STATUSES = [
  "open",
  "diagnosing",
  "awaiting_approval",
  "awaiting_parts",
  "in_progress",
  "quality_check",
  "ready",
  "closed",
  "cancelled",
] as const;

export type RoStatus = (typeof RO_STATUSES)[number];

/** Shop language, not database language. Nobody says "awaiting_parts" out loud. */
export const RO_STATUS_LABEL: Record<RoStatus, string> = {
  open: "Open",
  diagnosing: "Diagnosing",
  awaiting_approval: "Needs approval",
  awaiting_parts: "Waiting on parts",
  in_progress: "On the lift",
  quality_check: "Quality check",
  ready: "Ready",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const RO_STATUS_TONE: Record<RoStatus, Tone> = {
  open: "neutral",
  diagnosing: "blue",
  awaiting_approval: "person",
  awaiting_parts: "violet",
  in_progress: "blue",
  quality_check: "blue",
  ready: "zol",
  closed: "neutral",
  cancelled: "red",
};

/**
 * The order work moves through a shop. Drives the stepper on the ticket and
 * the columns on the board. `cancelled` is off the line on purpose — it is an
 * exit, not a stage.
 */
export const RO_PIPELINE: readonly RoStatus[] = [
  "open",
  "diagnosing",
  "awaiting_approval",
  "awaiting_parts",
  "in_progress",
  "quality_check",
  "ready",
  "closed",
];

/** Everything still in the building. */
export const RO_OPEN_STATUSES: readonly RoStatus[] = RO_STATUSES.filter(
  (status) => status !== "closed" && status !== "cancelled",
);

export function isRoStatus(value: string): value is RoStatus {
  return (RO_STATUSES as readonly string[]).includes(value);
}

// -----------------------------------------------------------------------------
// Priorities
// -----------------------------------------------------------------------------

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  low: "neutral",
  normal: "neutral",
  high: "person",
  urgent: "red",
};

// -----------------------------------------------------------------------------
// Lines and approvals
// -----------------------------------------------------------------------------

export const LINE_KINDS = ["labor", "part", "fee", "discount"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const LINE_KIND_LABEL: Record<LineKind, string> = {
  labor: "Labour",
  part: "Part",
  fee: "Fee",
  discount: "Discount",
};

export const APPROVALS = ["pending", "approved", "declined"] as const;
export type Approval = (typeof APPROVALS)[number];

export const APPROVAL_LABEL: Record<Approval, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};

export const APPROVAL_TONE: Record<Approval, Tone> = {
  pending: "person",
  approved: "zol",
  declined: "red",
};

// -----------------------------------------------------------------------------
// Appointments
// -----------------------------------------------------------------------------

export const APPOINTMENT_STATUSES = [
  "booked",
  "confirmed",
  "arrived",
  "no_show",
  "cancelled",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  booked: "Booked",
  confirmed: "Confirmed",
  arrived: "Arrived",
  no_show: "No-show",
  cancelled: "Cancelled",
};

export const APPOINTMENT_STATUS_TONE: Record<AppointmentStatus, Tone> = {
  booked: "neutral",
  confirmed: "blue",
  arrived: "zol",
  no_show: "red",
  cancelled: "red",
};

/** Where a booking or ticket came in through. */
export const SOURCES = ["counter", "agent", "web", "call", "portal"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<Source, string> = {
  counter: "Counter",
  agent: "ZOL",
  web: "Web chat",
  call: "Phone",
  portal: "Portal",
};

// -----------------------------------------------------------------------------
// Estimates, invoices, payments
// -----------------------------------------------------------------------------

export const ESTIMATE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "approved",
  "partial",
  "declined",
  "expired",
] as const;

export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const ESTIMATE_STATUS_LABEL: Record<EstimateStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  approved: "Approved",
  partial: "Partly approved",
  declined: "Declined",
  expired: "Expired",
};

export const ESTIMATE_STATUS_TONE: Record<EstimateStatus, Tone> = {
  draft: "neutral",
  sent: "blue",
  viewed: "blue",
  approved: "zol",
  partial: "person",
  declined: "red",
  expired: "neutral",
};

export const INVOICE_STATUSES = ["draft", "open", "partial", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  open: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
  void: "Void",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, Tone> = {
  draft: "neutral",
  open: "person",
  partial: "person",
  paid: "zol",
  void: "neutral",
};

export const PAYMENT_STATUSES = ["pending", "succeeded", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Pending",
  succeeded: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  pending: "person",
  succeeded: "zol",
  failed: "red",
  refunded: "neutral",
};

export const PAYMENT_METHODS = ["card", "cash", "check", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "Card",
  cash: "Cash",
  check: "Cheque",
  other: "Other",
};

export const PAYMENT_PROVIDERS = ["stripe", "manual", "demo"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

// -----------------------------------------------------------------------------
// Parts
// -----------------------------------------------------------------------------

export const PART_STATUSES = [
  "needed",
  "requested",
  "ordered",
  "received",
  "installed",
  "returned",
] as const;

export type PartStatus = (typeof PART_STATUSES)[number];

export const PART_STATUS_LABEL: Record<PartStatus, string> = {
  needed: "Needed",
  requested: "Requested",
  ordered: "Ordered",
  received: "Received",
  installed: "Installed",
  returned: "Returned",
};

export const PART_STATUS_TONE: Record<PartStatus, Tone> = {
  needed: "person",
  requested: "person",
  ordered: "violet",
  received: "blue",
  installed: "zol",
  returned: "neutral",
};

/** A part in one of these states is still holding the job up. */
export const PART_OUTSTANDING_STATUSES: readonly PartStatus[] = [
  "needed",
  "requested",
  "ordered",
];

// -----------------------------------------------------------------------------
// Inspections
// -----------------------------------------------------------------------------

export const RATINGS = ["green", "yellow", "red", "not_inspected"] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABEL: Record<Rating, string> = {
  green: "Good",
  yellow: "Watch",
  red: "Urgent",
  not_inspected: "Not checked",
};

export const RATING_TONE: Record<Rating, Tone> = {
  green: "zol",
  yellow: "person",
  red: "red",
  not_inspected: "neutral",
};

/** The systems a digital inspection walks through, in the order a tech does. */
export const INSPECTION_CATEGORIES = [
  "Engine",
  "Transmission",
  "Brakes",
  "Tires",
  "Suspension",
  "Steering",
  "Battery",
  "Fluids",
  "Lights",
  "Heating & A/C",
  "Exterior",
  "Interior",
  "Safety",
] as const;

// -----------------------------------------------------------------------------
// Follow-ups
// -----------------------------------------------------------------------------

export const FOLLOW_UP_KINDS = [
  "part_ordered",
  "in_progress",
  "diagnosis_ready",
  "ready_for_pickup",
  "declined_work_recall",
  "service_due",
  "birthday",
  "holiday",
  "custom",
  "appointment_confirmed",
  "appointment_reminder",
  "checked_in",
  "estimate_ready",
  "approved",
  "parts_received",
  "payment_receipt",
  "post_repair",
  "win_back",
  "inspection_recommendation",
] as const;

export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export const FOLLOW_UP_KIND_LABEL: Record<FollowUpKind, string> = {
  part_ordered: "Parts ordered",
  in_progress: "Work started",
  diagnosis_ready: "Diagnosis ready",
  ready_for_pickup: "Ready for pickup",
  declined_work_recall: "Declined work",
  service_due: "Service due",
  birthday: "Birthday",
  holiday: "Holiday",
  custom: "Custom",
  appointment_confirmed: "Booking confirmed",
  appointment_reminder: "Reminder",
  checked_in: "Checked in",
  estimate_ready: "Estimate ready",
  approved: "Approved",
  parts_received: "Parts arrived",
  payment_receipt: "Receipt",
  post_repair: "Post-repair check-in",
  win_back: "Win back",
  inspection_recommendation: "Inspection recommendation",
};

/**
 * Journey messages are ZOL keeping the customer posted about a live job. The
 * retention ones are the CRM: opportunities a person works through, usually
 * with a drafted message and a button.
 */
export const RETENTION_KINDS: readonly FollowUpKind[] = [
  "declined_work_recall",
  "service_due",
  "birthday",
  "holiday",
  "post_repair",
  "win_back",
  "inspection_recommendation",
  "custom",
];

export const FOLLOW_UP_STATUSES = ["pending", "sent", "done", "cancelled", "failed"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_STATUS_LABEL: Record<FollowUpStatus, string> = {
  pending: "Queued",
  sent: "Sent",
  done: "Done",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const FOLLOW_UP_STATUS_TONE: Record<FollowUpStatus, Tone> = {
  pending: "person",
  sent: "zol",
  done: "zol",
  cancelled: "neutral",
  failed: "red",
};

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

export const MESSAGE_CHANNELS = ["sms", "email", "portal", "note"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_CHANNEL_LABEL: Record<MessageChannel, string> = {
  sms: "Text",
  email: "Email",
  portal: "Portal",
  note: "Internal note",
};

export const MESSAGE_DIRECTIONS = ["inbound", "outbound", "internal"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

// -----------------------------------------------------------------------------
// Calls and conversations
// -----------------------------------------------------------------------------

export const CALL_STATUSES = [
  "ringing",
  "in_progress",
  "processing",
  "completed",
  "escalated",
  "missed",
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  ringing: "Ringing",
  in_progress: "On the call",
  processing: "Writing up",
  completed: "Completed",
  escalated: "Handed to a person",
  missed: "Missed",
};

export const CALL_STATUS_TONE: Record<CallStatus, Tone> = {
  ringing: "blue",
  in_progress: "blue",
  processing: "blue",
  completed: "zol",
  escalated: "person",
  missed: "red",
};

export const CALL_OUTCOMES = [
  "handled",
  "routed",
  "voicemail",
  "abandoned",
  "failed",
  "booked",
  "status_provided",
  "question_answered",
  "escalated",
  "no_action",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  handled: "Handled",
  routed: "Routed to counter",
  voicemail: "Voicemail",
  abandoned: "Abandoned",
  failed: "Failed",
  booked: "Booked",
  status_provided: "Status given",
  question_answered: "Question answered",
  escalated: "Needs a person",
  no_action: "No action",
};

export const CALL_OUTCOME_TONE: Record<CallOutcome, Tone> = {
  handled: "zol",
  routed: "person",
  voicemail: "neutral",
  abandoned: "neutral",
  failed: "red",
  booked: "zol",
  status_provided: "zol",
  question_answered: "zol",
  escalated: "person",
  no_action: "neutral",
};

export const CONVERSATION_STATUSES = [
  "open",
  "booked",
  "completed",
  "escalated",
  "abandoned",
] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_STATUS_LABEL: Record<ConversationStatus, string> = {
  open: "Open",
  booked: "Booked",
  completed: "Completed",
  escalated: "Needs a person",
  abandoned: "Abandoned",
};

export const CONVERSATION_STATUS_TONE: Record<ConversationStatus, Tone> = {
  open: "blue",
  booked: "zol",
  completed: "zol",
  escalated: "person",
  abandoned: "neutral",
};

export const URGENCIES = ["routine", "soon", "urgent", "stop_driving"] as const;
export type Urgency = (typeof URGENCIES)[number];

export const URGENCY_LABEL: Record<Urgency, string> = {
  routine: "Routine",
  soon: "Soon",
  urgent: "Urgent",
  stop_driving: "Stop driving",
};

export const URGENCY_TONE: Record<Urgency, Tone> = {
  routine: "neutral",
  soon: "blue",
  urgent: "person",
  stop_driving: "red",
};

// -----------------------------------------------------------------------------
// One lookup for the badge component
// -----------------------------------------------------------------------------

export type BadgeKind =
  | "ro"
  | "priority"
  | "approval"
  | "appointment"
  | "source"
  | "estimate"
  | "invoice"
  | "payment"
  | "part"
  | "rating"
  | "followUp"
  | "followUpKind"
  | "call"
  | "callOutcome"
  | "conversation"
  | "urgency"
  | "channel";

const TABLES: Record<
  BadgeKind,
  { label: Record<string, string>; tone?: Record<string, Tone> }
> = {
  ro: { label: RO_STATUS_LABEL, tone: RO_STATUS_TONE },
  priority: { label: PRIORITY_LABEL, tone: PRIORITY_TONE },
  approval: { label: APPROVAL_LABEL, tone: APPROVAL_TONE },
  appointment: { label: APPOINTMENT_STATUS_LABEL, tone: APPOINTMENT_STATUS_TONE },
  source: { label: SOURCE_LABEL },
  estimate: { label: ESTIMATE_STATUS_LABEL, tone: ESTIMATE_STATUS_TONE },
  invoice: { label: INVOICE_STATUS_LABEL, tone: INVOICE_STATUS_TONE },
  payment: { label: PAYMENT_STATUS_LABEL, tone: PAYMENT_STATUS_TONE },
  part: { label: PART_STATUS_LABEL, tone: PART_STATUS_TONE },
  rating: { label: RATING_LABEL, tone: RATING_TONE },
  followUp: { label: FOLLOW_UP_STATUS_LABEL, tone: FOLLOW_UP_STATUS_TONE },
  followUpKind: { label: FOLLOW_UP_KIND_LABEL },
  call: { label: CALL_STATUS_LABEL, tone: CALL_STATUS_TONE },
  callOutcome: { label: CALL_OUTCOME_LABEL, tone: CALL_OUTCOME_TONE },
  conversation: { label: CONVERSATION_STATUS_LABEL, tone: CONVERSATION_STATUS_TONE },
  urgency: { label: URGENCY_LABEL, tone: URGENCY_TONE },
  channel: { label: MESSAGE_CHANNEL_LABEL },
};

/** "awaiting_parts" → "Awaiting parts", for a value no table knows about. */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The label and tone for any status the app stores. Unknown values are
 * humanised rather than thrown on: a badge is not the place to crash a page
 * over a value that arrived from a newer migration.
 */
export function badgeFor(kind: BadgeKind, value: string | null | undefined): Badge {
  if (!value) return { label: "—", tone: "neutral" };
  const table = TABLES[kind];
  return {
    label: table.label[value] ?? humanize(value),
    tone: table.tone?.[value] ?? "neutral",
  };
}
