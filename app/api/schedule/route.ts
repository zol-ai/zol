import { authorized } from "@/lib/api-server";
import { createScheduleEvent, getScheduleEvents } from "@/lib/firestore/scheduleEvents";
import { scheduleEventCreateSchema, scheduleQuerySchema } from "@/lib/validation/schemas";

export async function GET(request: Request) {
  return authorized(async () => {
    const query = new URL(request.url).searchParams;
    return getScheduleEvents(
      scheduleQuerySchema.parse({
        from: query.get("from") ?? undefined,
        to: query.get("to") ?? undefined,
        assignedToId: query.get("assignedToId") ?? undefined,
      }),
    );
  });
}

export async function POST(request: Request) {
  return authorized(async () =>
    createScheduleEvent(scheduleEventCreateSchema.parse(await request.json())),
  );
}
