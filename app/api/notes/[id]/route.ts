import { authorized } from "@/lib/api-server";
import { deleteNote, getNoteById, updateNote } from "@/lib/firestore/notes";
import { noteUpdateSchema } from "@/lib/validation/schemas";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  return authorized(async () => getNoteById((await context.params).id));
}

export async function PATCH(request: Request, context: Context) {
  return authorized(async () =>
    updateNote((await context.params).id, noteUpdateSchema.parse(await request.json())),
  );
}

export async function DELETE(_: Request, context: Context) {
  return authorized(async () => {
    await deleteNote((await context.params).id);
    return { ok: true };
  });
}
