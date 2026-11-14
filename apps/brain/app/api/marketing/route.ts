import { authorized } from "@/lib/api-server";
import {
  createMarketingIdea,
  getMarketingIdeas,
} from "@/lib/firestore/marketingIdeas";
import { marketingIdeaCreateSchema } from "@/lib/validation/schemas";

export async function GET() {
  return authorized(async () => getMarketingIdeas());
}

export async function POST(request: Request) {
  return authorized(async () =>
    createMarketingIdea(marketingIdeaCreateSchema.parse(await request.json())),
  );
}
