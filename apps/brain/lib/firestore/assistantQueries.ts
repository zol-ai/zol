import "server-only";

import { getClients } from "@/lib/firestore/clients";
import { getTasks } from "@/lib/firestore/tasks";
import { getTeamMembers } from "@/lib/firestore/teamMembers";
import { summarizeWorkspace } from "@/lib/ai/metrics";
import type {
  ClientSummaryArgs,
  FindTasksArgs,
  TeamWorkloadArgs,
} from "@/lib/validation/companyBrain";

const companyTimeZone = process.env.COMPANY_TIME_ZONE || "America/Los_Angeles";

function todayInCompanyTimeZone() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: companyTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function resolveName<T extends { id: string; name: string }>(
  records: T[],
  requestedName: string,
) {
  const requested = normalize(requestedName);
  const exact = records.find((record) => normalize(record.name) === requested);
  if (exact) return { record: exact };

  const possible = records.filter((record) => normalize(record.name).includes(requested));
  if (possible.length === 1) return { record: possible[0] };
  return {
    error:
      possible.length > 1
        ? `The name "${requestedName}" is ambiguous.`
        : `No record matched "${requestedName}".`,
    matches: possible.map((record) => ({ id: record.id, name: record.name })),
  };
}

export async function getWorkspaceSummary() {
  const [tasks, members, clients] = await Promise.all([
    getTasks(),
    getTeamMembers(),
    getClients(),
  ]);
  const today = todayInCompanyTimeZone();
  return summarizeWorkspace(tasks, members, clients, today, companyTimeZone);
}

export async function findTasksForAssistant(args: FindTasksArgs) {
  const [tasks, members, clients] = await Promise.all([
    getTasks(),
    getTeamMembers(),
    getClients(),
  ]);
  const today = todayInCompanyTimeZone();
  let assigneeId: string | undefined;
  let clientId: string | undefined;

  if (args.assigneeName) {
    const resolution = resolveName(members, args.assigneeName);
    if (!resolution.record) return resolution;
    assigneeId = resolution.record.id;
  }
  if (args.clientName) {
    const resolution = resolveName(clients, args.clientName);
    if (!resolution.record) return resolution;
    clientId = resolution.record.id;
  }

  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const matches = tasks.filter((task) => {
    if (args.status && task.status !== args.status) return false;
    if (args.priority && task.priority !== args.priority) return false;
    if (assigneeId && task.assignedToId !== assigneeId) return false;
    if (clientId && task.clientId !== clientId) return false;
    if (args.dueDateState) {
      if (args.dueDateState === "no_due" && task.dueDate) return false;
      if (args.dueDateState === "today" && (task.status === "completed" || task.dueDate !== today)) return false;
      if (
        args.dueDateState === "overdue" &&
        (task.status === "completed" || !task.dueDate || task.dueDate >= today)
      ) return false;
      if (
        args.dueDateState === "upcoming" &&
        (task.status === "completed" || !task.dueDate || task.dueDate <= today)
      ) return false;
    }
    return true;
  });

  return {
    generatedAt: new Date().toISOString(),
    timeZone: companyTimeZone,
    totalMatches: matches.length,
    returned: Math.min(matches.length, args.limit),
    tasks: matches.slice(0, args.limit).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate ?? null,
      assignee: task.assignedToName ?? "Unassigned",
      client: task.clientId ? clientNames.get(task.clientId) ?? "Unknown client" : null,
    })),
  };
}

export async function getTeamWorkload(args: TeamWorkloadArgs) {
  const [tasks, members] = await Promise.all([getTasks(), getTeamMembers()]);
  let selectedMembers = members;

  if (args.memberName) {
    const resolution = resolveName(members, args.memberName);
    if (!resolution.record) return resolution;
    selectedMembers = [resolution.record];
  }

  return {
    generatedAt: new Date().toISOString(),
    people: selectedMembers.map((member) => {
      const assigned = tasks.filter((task) => task.assignedToId === member.id);
      return {
        id: member.id,
        name: member.name,
        role: member.role ?? null,
        active: member.active,
        totalTasks: assigned.length,
        openTasks: assigned.filter((task) => task.status !== "completed").length,
        todoTasks: assigned.filter((task) => task.status === "todo").length,
        inProgressTasks: assigned.filter((task) => task.status === "in_progress").length,
        completedTasks: assigned.filter((task) => task.status === "completed").length,
      };
    }),
  };
}

export async function getClientSummaries(args: ClientSummaryArgs) {
  const [tasks, clients] = await Promise.all([getTasks(), getClients()]);
  let selectedClients = clients.filter(
    (client) => !args.status || client.status === args.status,
  );

  if (args.clientName) {
    const resolution = resolveName(selectedClients, args.clientName);
    if (!resolution.record) return resolution;
    selectedClients = [resolution.record];
  }

  const matches = selectedClients.slice(0, args.limit);
  return {
    generatedAt: new Date().toISOString(),
    totalMatches: selectedClients.length,
    returned: matches.length,
    clients: matches.map((client) => {
      const related = tasks.filter((task) => task.clientId === client.id);
      return {
        id: client.id,
        name: client.name,
        status: client.status,
        totalTasks: related.length,
        openTasks: related.filter((task) => task.status !== "completed").length,
        completedTasks: related.filter((task) => task.status === "completed").length,
      };
    }),
  };
}
