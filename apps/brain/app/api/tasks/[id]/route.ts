import { authorized } from "@/lib/api-server";
import { deleteTask, getTaskById, updateTask } from "@/lib/firestore/tasks";
import { taskUpdateSchema } from "@/lib/validation/schemas";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  return authorized(async () => getTaskById((await context.params).id));
}

export async function PATCH(request: Request, context: Context) {
  return authorized(async () =>
    updateTask((await context.params).id, taskUpdateSchema.parse(await request.json())),
  );
}

export async function DELETE(_: Request, context: Context) {
  return authorized(async () => {
    await deleteTask((await context.params).id);
    return { ok: true };
  });
}
