import { authorized } from "@/lib/api-server";
import {
  deleteMarketingIdea,
  getMarketingIdeaById,
  updateMarketingIdea,
} from "@/lib/firestore/marketingIdeas";
import { marketingIdeaUpdateSchema } from "@/lib/validation/schemas";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  return authorized(async () => getMarketingIdeaById((await context.params).id));
}

export async function PATCH(request: Request, context: Context) {
  return authorized(async () =>
    updateMarketingIdea(
      (await context.params).id,
      marketingIdeaUpdateSchema.parse(await request.json()),
    ),
  );
}

export async function DELETE(_: Request, context: Context) {
  return authorized(async () => {
    await deleteMarketingIdea((await context.params).id);
    return { ok: true };
  });
}
