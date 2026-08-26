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

export const clientCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  contactName: z.string().trim().max(160).optional().transform((value) => value || undefined),
  contactEmail: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  status: z.enum(["lead", "active", "paused", "closed"]).default("lead"),
  color: clientColorSchema.default("blue"),
  notes: optionalText,
});

export const clientUpdateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160).optional(),
  contactName: z.string().trim().max(160).optional().transform((value) => value || undefined),
  contactEmail: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  status: z.enum(["lead", "active", "paused", "closed"]).optional(),
  color: clientColorSchema.optional(),
  notes: optionalText,
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

export const cardUpdateSchema = z.object({
  title: z.string().trim().min(1, "Heading is required").max(160).optional(),
  todos: z.array(cardTodoSchema).max(50).optional(),
  color: z.enum(["blue", "green", "amber", "rose", "violet", "slate"]).optional(),
  order: z.number().finite().nonnegative().optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);

export type TaskInput = z.infer<typeof taskCreateSchema>;
export type TeamMemberInput = z.infer<typeof teamMemberCreateSchema>;
export type ClientInput = z.infer<typeof clientCreateSchema>;
export type CardInput = z.infer<typeof cardCreateSchema>;
