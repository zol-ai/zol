import { authorized } from "@/lib/api-server";
import {
  deleteClient,
  getClientById,
  updateClient,
} from "@/lib/firestore/clients";
import { clientUpdateSchema } from "@/lib/validation/schemas";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  return authorized(async () => getClientById((await context.params).id));
}

export async function PATCH(request: Request, context: Context) {
  return authorized(async () =>
    updateClient((await context.params).id, clientUpdateSchema.parse(await request.json())),
  );
}

export async function DELETE(_: Request, context: Context) {
  return authorized(async () => {
    await deleteClient((await context.params).id);
    return { ok: true };
  });
}
