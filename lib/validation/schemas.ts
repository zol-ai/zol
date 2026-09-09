import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => value || undefined);

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optionalText,
  assignedToId: z.string().trim().optional().transform((value) => value || undefined),
  assignedToName: z.string().trim().optional().transform((value) => value || undefined),
  status: z.enum(["todo", "in_progress", "completed"]).default("todo"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  clientId: z.string().trim().optional().transform((value) => value || undefined),
});

export const taskUpdateSchema = taskCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);

export const teamMemberCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  role: z.string().trim().max(120).optional().transform((value) => value || undefined),
  active: z.boolean().default(true),
});

export const teamMemberUpdateSchema = teamMemberCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);

const clientColorSchema = z.enum(["blue", "green", "amber", "rose", "violet", "slate"]);

/**
 * E.164, the same rule the sending side enforces with a CHECK constraint.
 *
 * Validated, never normalised. The sender is responsible for sending a number
 * in this shape; quietly reformatting whatever arrives would mean two systems
 * with two ideas of what a phone number looks like, and phone is the key
 * inbound events are matched on — a disagreement there is a duplicate client,
 * not a cosmetic difference.
 */
export const e164Schema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone must be E.164, e.g. +15555550148");

export const clientCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  contactName: z.string().trim().max(160).optional().transform((value) => value || undefined),
  contactEmail: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  status: z.enum(["lead", "active", "paused", "closed"]).default("lead"),
  color: clientColorSchema.default("blue"),
  notes: optionalText,
  phone: e164Schema.optional().or(z.literal("").transform(() => undefined)),
  zip: z.string().trim().max(16).optional().transform((value) => value || undefined),
  bays: z.string().trim().max(16).optional().transform((value) => value || undefined),
  /** Which pipeline the record belongs to. Defaults to the built-in Clients CRM. */
  crmId: z.string().trim().min(1).max(60).default("clients"),
  /*
    Anything created through the API is somebody typing it in. Only the ingest
    route sets "waitlist", and it does not go through this schema.
  */
  source: z.enum(["manual", "waitlist"]).default("manual"),
});

export const crmCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
});

export const clientUpdateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160).optional(),
  contactName: z.string().trim().max(160).optional().transform((value) => value || undefined),
  contactEmail: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  status: z.enum(["lead", "active", "paused", "closed"]).optional(),
  color: clientColorSchema.optional(),
  notes: optionalText,
  phone: e164Schema.optional().or(z.literal("").transform(() => undefined)),
  zip: z.string().trim().max(16).optional().transform((value) => value || undefined),
  bays: z.string().trim().max(16).optional().transform((value) => value || undefined),
  // `source` is absent on purpose. It is immutable after creation.
}).refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);

const cardTodoSchema = z.object({
  id: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1, "Todo text is required").max(240),
  done: z.boolean().default(false),
});

export const cardCreateSchema = z.object({
  title: z.string().trim().min(1, "Heading is required").max(160),
  todos: z.array(cardTodoSchema).max(50).default([]),
  color: z.enum(["blue", "green", "amber", "rose", "violet", "slate"]).default("blue"),
  order: z.number().finite().nonnegative().default(0),
});

const noteColorSchema = z.enum(["blue", "green", "amber", "rose", "violet", "slate"]);

export const noteCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  body: z.string().trim().max(4000).default(""),
  color: noteColorSchema.default("amber"),
});

export const noteUpdateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160).optional(),
  body: z.string().trim().max(4000).optional(),
  color: noteColorSchema.optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);

export const cardUpdateSchema = z.object({
  title: z.string().trim().min(1, "Heading is required").max(160).optional(),
  todos: z.array(cardTodoSchema).max(50).optional(),
  color: z.enum(["blue", "green", "amber", "rose", "violet", "slate"]).optional(),
  order: z.number().finite().nonnegative().optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);

// --- Schedule ----------------------------------------------------------------

const scheduleColorSchema = z.enum(["blue", "green", "amber", "rose", "violet", "slate"]);

/** A real calendar day, not just digits in the right places: 2026-02-30 is rejected. */
function isCalendarDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(isCalendarDay, "Date must be a real calendar day");

const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM");

const optionalDay = calendarDay.optional().or(z.literal("").transform(() => undefined));
const optionalTime = clockTime.optional().or(z.literal("").transform(() => undefined));
const optionalId = z.string().trim().optional().transform((value) => value || undefined);

const scheduleEventFields = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optionalText,
  date: calendarDay,
  endDate: optionalDay,
  allDay: z.boolean().default(false),
  startTime: optionalTime,
  endTime: optionalTime,
  assignedToId: optionalId,
  color: scheduleColorSchema.default("blue"),
});

/**
 * The full-record schema. Updates go through it too: the Firestore helper
 * merges a PATCH onto the stored document and re-parses the result here, so
 * the cross-field rules below hold no matter which half of a window changed.
 */
export const scheduleEventCreateSchema = scheduleEventFields
  .superRefine((value, ctx) => {
    if (value.endDate && value.endDate < value.date) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be on or after the start date",
      });
    }
    if (!value.allDay && !value.startTime) {
      ctx.addIssue({
        code: "custom",
        path: ["startTime"],
        message: "Start time is required unless the event is all day",
      });
    }
    const singleDay = !value.endDate || value.endDate === value.date;
    if (
      !value.allDay &&
      value.startTime &&
      value.endTime &&
      singleDay &&
      value.endTime <= value.startTime
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "End time must be after the start time",
      });
    }
  })
  .transform((value) =>
    // An all-day event has no clock times, whatever the form sent along with it.
    value.allDay ? { ...value, startTime: undefined, endTime: undefined } : value,
  );

export const scheduleEventUpdateSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200).optional(),
    description: optionalText,
    date: calendarDay.optional(),
    endDate: optionalDay,
    allDay: z.boolean().optional(),
    startTime: optionalTime,
    endTime: optionalTime,
    assignedToId: optionalId,
    color: scheduleColorSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const scheduleQuerySchema = z
  .object({
    from: calendarDay.optional(),
    to: calendarDay.optional(),
    assignedToId: optionalId,
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    path: ["to"],
    message: "to must be on or after from",
  });

const marketingLinkSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1, "Link label is required").max(120),
    url: z.string().trim().url("Enter a valid URL").max(2000),
  })
  .strict();

const marketingContentTypeSchema = z.enum([
  "video",
  "social_post",
  "blog",
  "email",
  "campaign",
  "other",
]);

const marketingChannelSchema = z.enum([
  "instagram",
  "linkedin",
  "youtube",
  "tiktok",
  "x",
  "email",
  "website",
  "other",
]);

const marketingStatusSchema = z.enum(["idea", "planned", "creating", "ready", "posted"]);

export const marketingIdeaCreateSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    brief: optionalText,
    hook: z.string().trim().max(1000).optional().transform((value) => value || undefined),
    callToAction: z.string().trim().max(500).optional().transform((value) => value || undefined),
    contentType: marketingContentTypeSchema.default("social_post"),
    channel: marketingChannelSchema
      .optional()
      .or(z.literal("").transform(() => undefined)),
    ownerId: optionalId,
    targetDate: optionalDay,
    links: z.array(marketingLinkSchema).max(10).default([]),
    status: marketingStatusSchema.default("idea"),
  })
  .strict();

export const marketingIdeaUpdateSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200).optional(),
    brief: optionalText,
    hook: z.string().trim().max(1000).optional().transform((value) => value || undefined),
    callToAction: z.string().trim().max(500).optional().transform((value) => value || undefined),
    contentType: marketingContentTypeSchema.optional(),
    channel: marketingChannelSchema
      .optional()
      .or(z.literal("").transform(() => undefined)),
    ownerId: optionalId,
    targetDate: optionalDay,
    links: z.array(marketingLinkSchema).max(10).optional(),
    status: marketingStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type ScheduleEventInput = z.infer<typeof scheduleEventCreateSchema>;
export type ScheduleEventUpdateInput = z.infer<typeof scheduleEventUpdateSchema>;
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;
export type MarketingIdeaInput = z.infer<typeof marketingIdeaCreateSchema>;
export type MarketingIdeaUpdateInput = z.infer<typeof marketingIdeaUpdateSchema>;

export type TaskInput = z.infer<typeof taskCreateSchema>;
export type TeamMemberInput = z.infer<typeof teamMemberCreateSchema>;
export type ClientInput = z.infer<typeof clientCreateSchema>;
export type CardInput = z.infer<typeof cardCreateSchema>;
export type NoteInput = z.infer<typeof noteCreateSchema>;
export type CrmInput = z.infer<typeof crmCreateSchema>;
