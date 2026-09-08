import { authorized } from "@/lib/api-server";
import {
  deleteScheduleEvent,
  getScheduleEventById,
  updateScheduleEvent,
} from "@/lib/firestore/scheduleEvents";
import { scheduleEventUpdateSchema } from "@/lib/validation/schemas";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  return authorized(async () => getScheduleEventById((await context.params).id));
}

export async function PATCH(request: Request, context: Context) {
  return authorized(async () =>
    updateScheduleEvent(
      (await context.params).id,
      scheduleEventUpdateSchema.parse(await request.json()),
    ),
  );
}

export async function DELETE(_: Request, context: Context) {
  return authorized(async () => {
    await deleteScheduleEvent((await context.params).id);
    return { ok: true };
  });
}
