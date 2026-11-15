import { authorized } from "@/lib/api-server";
import { createCrm, getCrms } from "@/lib/firestore/crms";
import { crmCreateSchema } from "@/lib/validation/schemas";

export async function GET() {
  return authorized(async () => getCrms());
}

export async function POST(request: Request) {
  return authorized(async () => createCrm(crmCreateSchema.parse(await request.json())));
}
