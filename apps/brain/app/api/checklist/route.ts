import { authorized } from "@/lib/api-server";
import { createChecklistItem, getChecklistDay } from "@/lib/firestore/checklist";
import {
  checklistDayQuerySchema,
  checklistItemCreateSchema,
} from "@/lib/validation/schemas";

export async function GET(request: Request) {
  return authorized(async () => {
    const date = new URL(request.url).searchParams.get("date");
    // Absent and empty both mean "whatever today is", which the Firestore
    // helper fills in. A malformed date is still an error rather than a
    // silent fall back to today.
    const { date: day } = checklistDayQuerySchema.parse(date ? { date } : {});
    return getChecklistDay(day);
  });
}

export async function POST(request: Request) {
  return authorized(async () =>
    createChecklistItem(checklistItemCreateSchema.parse(await request.json())),
  );
}
