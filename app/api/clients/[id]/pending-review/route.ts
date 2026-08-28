import { z } from "zod";

import { authorized } from "@/lib/api-server";
import { resolvePendingReview } from "@/lib/firestore/clients";

type Context = { params: Promise<{ id: string }> };

/**
 * Settling a field an inbound event disagreed with.
 *
 * Its own route rather than a shape bolted onto `PATCH /api/clients/[id]`:
 * that endpoint takes a partial client and would have to grow a special case
 * that both writes a field and clears a review entry atomically. Separating
 * them keeps the ordinary edit path unchanged and makes "I settled a conflict"
 * legible in the logs as its own action.
 *
 * Behind `authorized()`, like everything else a person does. Only `/api/events`
 * is outside it.
 */
const resolveSchema = z.object({
  field: z.string().trim().min(1).max(60),
  action: z.enum(["accept", "dismiss"]),
});

export async function POST(request: Request, context: Context) {
  return authorized(async () => {
    const { field, action } = resolveSchema.parse(await request.json());
    return resolvePendingReview((await context.params).id, field, action);
  });
}
