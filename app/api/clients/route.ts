import { authorized } from "@/lib/api-server";
import { createClient, getClients } from "@/lib/firestore/clients";
import { clientCreateSchema } from "@/lib/validation/schemas";

export async function GET() {
  return authorized(async () => getClients());
}

export async function POST(request: Request) {
  return authorized(async () => createClient(clientCreateSchema.parse(await request.json())));
}
