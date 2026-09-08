export type TaskStatus = "todo" | "in_progress" | "completed";
export type TaskPriority = "low" | "medium" | "high";
export type ClientStatus = "lead" | "active" | "paused" | "closed";
export type ClientColor = "blue" | "green" | "amber" | "rose" | "violet" | "slate";
export type WorkCardColor = "blue" | "green" | "amber" | "rose" | "violet" | "slate";
export type NoteColor = "blue" | "green" | "amber" | "rose" | "violet" | "slate";

export type TeamMember = {
  id: string;
  name: string;
  email?: string;
  role?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  assignedToId?: string;
  assignedToName?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  clientId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

/**
 * Where a client record came from. Immutable after creation: it records how the
 * record arrived, which does not change because somebody later approved it. A
 * promoted waitlist lead stays "waitlist" forever and becomes visible in the
 * CRM because its status changed, not its source.
 */
export type ClientSource = "manual" | "waitlist";

/**
 * A CRM is a named pipeline — Clients, Investors, whatever the team needs
 * next. Records carry a `crmId`; the CRM page shows one pipeline at a time.
 *
 * The default CRM has the fixed document ID "clients". Waitlist ingest always
 * writes there, so inbound leads cannot land in (or merge across) any other
 * pipeline.
 */
export type Crm = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

/** The fixed ID of the default CRM that waitlist ingest writes to. */
export const DEFAULT_CRM_ID = "clients";

/** One person attached to a client. The first one is also the top-level contact. */
export type ClientContact = {
  name?: string;
  email?: string;
  /**
   * The bare event_id of the submission this person came from — not the
   * `event_id:revision` delivery key. It points at the person's row, not at
   * one delivery of it.
   */
  sourceEventId?: string;
};

/**
 * A field where an inbound event disagreed with what is stored.
 *
 * Inbound events never overwrite a non-null value. When the form says one
 * thing and the record says another, the record wins and the disagreement
 * lands here for somebody to settle.
 */
export type PendingReviewEntry = {
  /**
   * The value awaiting a decision — always the one *not* currently stored, so
   * accepting means adopting it and dismissing means keeping what is there.
   * Which value that is depends on `reason`.
   */
  incoming: string;
  /**
   * "conflict" — the form disagreed with a stored value. The record won;
   *   `incoming` is what the form said. Accept to take it.
   *
   * "replaced" — a phone correction matched this record through its history,
   *   so the new number was written straight in. `incoming` is the number it
   *   displaced. Accept to put the old one back, dismiss to keep the change.
   *
   * The mechanics are identical either way. Only the wording differs.
   */
  reason: "conflict" | "replaced";
  sourceEventId?: string;
  at: string;
};

export type Client = {
  id: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
  status: ClientStatus;
  color: ClientColor;
  notes?: string;
  createdAt: string;
  updatedAt: string;

  /** E.164. The match key for inbound waitlist events. */
  phone?: string;
  zip?: string;
  bays?: string;
  /** Which pipeline this record belongs to. Absent means the default CRM. */
  crmId?: string;
  source: ClientSource;
  contacts?: ClientContact[];
  /** Consent to be called and texted, as captured by the waitlist form. */
  consentAt?: string;
  /** Last time an inbound event touched this record, whatever it changed. */
  lastInboundAt?: string;
  /** Keyed by field name. Empty or absent when there is nothing to settle. */
  pendingReview?: Record<string, PendingReviewEntry>;
};

export type WorkCardTodo = {
  id: string;
  text: string;
  done: boolean;
};

export type WorkCard = {
  id: string;
  title: string;
  todos: WorkCardTodo[];
  color: WorkCardColor;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceNote = {
  id: string;
  title: string;
  body: string;
  color: NoteColor;
  createdAt: string;
  updatedAt: string;
};

export type TeamMemberDocument = Omit<TeamMember, "id" | "createdAt" | "updatedAt"> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

export type TaskDocument = Omit<
  Task,
  "id" | "createdAt" | "updatedAt" | "completedAt"
> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  completedAt?: FirebaseFirestore.Timestamp | null;
};

export type ClientDocument = Omit<Client, "id" | "createdAt" | "updatedAt"> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

export type WorkCardDocument = Omit<WorkCard, "id" | "createdAt" | "updatedAt"> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

export type WorkspaceNoteDocument = Omit<WorkspaceNote, "id" | "createdAt" | "updatedAt"> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

export type ScheduleColor = "blue" | "green" | "amber" | "rose" | "violet" | "slate";

/**
 * One entry on the team schedule.
 *
 * Dates are calendar days (YYYY-MM-DD) and times are HH:MM in the company's
 * local day. Nothing here is an instant: a 9am standup is 9am wherever the
 * team happens to be reading it, which is what a shared calendar means.
 */
export type ScheduleEvent = {
  id: string;
  title: string;
  description?: string;
  /** First (or only) day. */
  date: string;
  /** Last day of a multi-day entry. Absent means the event is a single day. */
  endDate?: string;
  allDay: boolean;
  /** Absent when allDay. */
  startTime?: string;
  endTime?: string;
  assignedToId?: string;
  assignedToName?: string;
  color: ScheduleColor;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleEventDocument = Omit<ScheduleEvent, "id" | "createdAt" | "updatedAt"> & {
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};
