import { authorized } from "@/lib/api-server";
import { deleteCard, getCardById, updateCard } from "@/lib/firestore/cards";
import { cardUpdateSchema } from "@/lib/validation/schemas";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  return authorized(async () => getCardById((await context.params).id));
}

export async function PATCH(request: Request, context: Context) {
  return authorized(async () =>
    updateCard((await context.params).id, cardUpdateSchema.parse(await request.json())),
  );
}

export async function DELETE(_: Request, context: Context) {
  return authorized(async () => {
    await deleteCard((await context.params).id);
    return { ok: true };
  });
}
