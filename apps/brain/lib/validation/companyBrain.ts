import { z } from "zod";

export const companyBrainRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().trim().min(1).max(3000),
        }),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .refine(
    ({ messages }) =>
      messages.reduce((total, message) => total + message.content.length, 0) <= 12000,
    "Conversation is too long. Clear the chat and try again.",
  )
  .refine(
    ({ messages }) => messages.at(-1)?.role === "user",
    "The last message must be from the user.",
  );

export const workspaceSummaryArgsSchema = z.object({}).strict();

export const findTasksArgsSchema = z
  .object({
    status: z.enum(["todo", "in_progress", "completed"]).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    assigneeName: z.string().trim().min(1).max(120).optional(),
    clientName: z.string().trim().min(1).max(160).optional(),
    dueDateState: z
      .enum(["today", "overdue", "upcoming", "no_due"])
      .optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

export const teamWorkloadArgsSchema = z
  .object({
    memberName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const clientSummaryArgsSchema = z
  .object({
    clientName: z.string().trim().min(1).max(160).optional(),
    status: z.enum(["lead", "active", "paused", "closed"]).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

export type FindTasksArgs = z.infer<typeof findTasksArgsSchema>;
export type TeamWorkloadArgs = z.infer<typeof teamWorkloadArgsSchema>;
export type ClientSummaryArgs = z.infer<typeof clientSummaryArgsSchema>;
