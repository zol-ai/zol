import "server-only";

import type { FunctionTool } from "openai/resources/responses/responses";
import {
  findTasksForAssistant,
  getClientSummaries,
  getTeamWorkload,
  getWorkspaceSummary,
} from "@/lib/firestore/assistantQueries";
import {
  clientSummaryArgsSchema,
  findTasksArgsSchema,
  teamWorkloadArgsSchema,
  workspaceSummaryArgsSchema,
} from "@/lib/validation/companyBrain";

export const companyBrainTools: FunctionTool[] = [
  {
    type: "function" as const,
    name: "get_workspace_summary",
    description:
      "Get exact current totals for tasks, task statuses, due and overdue work, people, and clients. Use this for any count or overall status question.",
    strict: false,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "find_tasks",
    description:
      "Find current tasks using optional status, priority, assignee name, client name, or due-date filters. Results are ordered with open due work first.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["todo", "in_progress", "completed"],
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        assigneeName: { type: "string" },
        clientName: { type: "string" },
        dueDateState: {
          type: "string",
          enum: ["today", "overdue", "upcoming", "no_due"],
        },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_team_workload",
    description:
      "Get exact assigned task counts for every team member or one named person.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        memberName: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function" as const,
    name: "get_client_summaries",
    description:
      "Get clients with their current status and exact related open/completed task counts.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        clientName: { type: "string" },
        status: {
          type: "string",
          enum: ["lead", "active", "paused", "closed"],
        },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
];

function parseArguments(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("The model supplied invalid tool arguments.");
  }
}

export async function executeCompanyBrainTool(name: string, argumentsJson: string) {
  const input = parseArguments(argumentsJson);
  switch (name) {
    case "get_workspace_summary":
      workspaceSummaryArgsSchema.parse(input);
      return getWorkspaceSummary();
    case "find_tasks":
      return findTasksForAssistant(findTasksArgsSchema.parse(input));
    case "get_team_workload":
      return getTeamWorkload(teamWorkloadArgsSchema.parse(input));
    case "get_client_summaries":
      return getClientSummaries(clientSummaryArgsSchema.parse(input));
    default:
      throw new Error(`Unknown Company Brain tool: ${name}`);
  }
}
