import type { Client, Task, TeamMember } from "@/types";

export function summarizeWorkspace(
  tasks: Task[],
  members: TeamMember[],
  clients: Client[],
  today: string,
  timeZone: string,
) {
  const openTasks = tasks.filter((task) => task.status !== "completed");

  return {
    generatedAt: new Date().toISOString(),
    timeZone,
    asOfDate: today,
    tasks: {
      total: tasks.length,
      open: openTasks.length,
      todo: tasks.filter((task) => task.status === "todo").length,
      inProgress: tasks.filter((task) => task.status === "in_progress").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      dueToday: openTasks.filter((task) => task.dueDate === today).length,
      overdue: openTasks.filter((task) => task.dueDate && task.dueDate < today).length,
      unassigned: openTasks.filter((task) => !task.assignedToId).length,
    },
    people: {
      total: members.length,
      active: members.filter((member) => member.active).length,
      archived: members.filter((member) => !member.active).length,
    },
    clients: {
      total: clients.length,
      lead: clients.filter((client) => client.status === "lead").length,
      active: clients.filter((client) => client.status === "active").length,
      paused: clients.filter((client) => client.status === "paused").length,
      closed: clients.filter((client) => client.status === "closed").length,
    },
  };
}
