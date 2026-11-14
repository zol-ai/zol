import { authorized } from "@/lib/api-server";
import { createTask, getTasks } from "@/lib/firestore/tasks";
import { taskCreateSchema } from "@/lib/validation/schemas";
import type { TaskPriority, TaskStatus } from "@/types";

export async function GET(request: Request) {
  return authorized(async () => {
    const query = new URL(request.url).searchParams;
    return getTasks({
      assignedToId: query.get("assignedToId") || undefined,
      status: (query.get("status") as TaskStatus | null) || undefined,
      priority: (query.get("priority") as TaskPriority | null) || undefined,
      clientId: query.get("clientId") || undefined,
      dueDate: query.get("dueDate") || undefined,
    });
  });
}

export async function POST(request: Request) {
  return authorized(async () => createTask(taskCreateSchema.parse(await request.json())));
}
