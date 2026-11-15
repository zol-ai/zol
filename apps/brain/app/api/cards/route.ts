import { authorized } from "@/lib/api-server";
import { createCard, getCards } from "@/lib/firestore/cards";
import { cardCreateSchema } from "@/lib/validation/schemas";

export async function GET() {
  return authorized(async () => getCards());
}

export async function POST(request: Request) {
  return authorized(async () => createCard(cardCreateSchema.parse(await request.json())));
}
