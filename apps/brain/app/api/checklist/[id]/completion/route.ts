import { authorized } from "@/lib/api-server";
import { setChecklistCompletion } from "@/lib/firestore/checklist";
import { checklistCompletionSchema } from "@/lib/validation/schemas";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return authorized(async (user) =>
    setChecklistCompletion(
      (await context.params).id,
      checklistCompletionSchema.parse(await request.json()),
      user.email,
    ),
  );
}
