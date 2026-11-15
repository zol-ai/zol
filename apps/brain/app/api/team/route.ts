import { authorized } from "@/lib/api-server";
import { createTeamMember, getTeamMembers } from "@/lib/firestore/teamMembers";
import { teamMemberCreateSchema } from "@/lib/validation/schemas";

export async function GET(request: Request) {
  return authorized(async () => {
    const activeOnly = new URL(request.url).searchParams.get("active") === "true";
    return getTeamMembers({ activeOnly });
  });
}

export async function POST(request: Request) {
  return authorized(async () =>
    createTeamMember(teamMemberCreateSchema.parse(await request.json())),
  );
}
