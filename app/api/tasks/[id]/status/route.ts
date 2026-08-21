import { z } from "zod";
import { authorized } from "@/lib/api-server";
import { completeTask, reopenTask } from "@/lib/firestore/tasks";

const schema = z.object({ action: z.enum(["complete", "reopen"]) });
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return authorized(async () => {
    const { action } = schema.parse(await request.json());
    const { id } = await context.params;
    return action === "complete" ? completeTask(id) : reopenTask(id);
  });
}
