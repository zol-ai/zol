import { authorized } from "@/lib/api-server";
import { createNote, getNotes } from "@/lib/firestore/notes";
import { noteCreateSchema } from "@/lib/validation/schemas";

export async function GET() {
  return authorized(async () => getNotes());
}

export async function POST(request: Request) {
  return authorized(async () => createNote(noteCreateSchema.parse(await request.json())));
}
