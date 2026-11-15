import { z } from "zod";
import { authorized } from "@/lib/api-server";
import {
  deactivateTeamMember,
  getTeamMemberById,
  updateTeamMember,
} from "@/lib/firestore/teamMembers";
import { teamMemberUpdateSchema } from "@/lib/validation/schemas";

type Context = { params: Promise<{ id: string }> };
const archiveSchema = z.object({ action: z.literal("deactivate") });

export async function GET(_: Request, context: Context) {
  return authorized(async () => getTeamMemberById((await context.params).id));
}

export async function PATCH(request: Request, context: Context) {
  return authorized(async () => {
    const body: unknown = await request.json();
    const archive = archiveSchema.safeParse(body);
    return archive.success
      ? deactivateTeamMember((await context.params).id)
      : updateTeamMember(
          (await context.params).id,
          teamMemberUpdateSchema.parse(body),
        );
  });
}
