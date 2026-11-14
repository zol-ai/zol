import { authorized } from "@/lib/api-server";
import {
  deleteChecklistItem,
  getChecklistItemById,
  updateChecklistItem,
} from "@/lib/firestore/checklist";
import { checklistItemUpdateSchema } from "@/lib/validation/schemas";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  return authorized(async () => getChecklistItemById((await context.params).id));
}

export async function PATCH(request: Request, context: Context) {
  return authorized(async () =>
    updateChecklistItem(
      (await context.params).id,
      checklistItemUpdateSchema.parse(await request.json()),
    ),
  );
}

export async function DELETE(_: Request, context: Context) {
  return authorized(async () => {
    await deleteChecklistItem((await context.params).id);
    return { ok: true };
  });
}
