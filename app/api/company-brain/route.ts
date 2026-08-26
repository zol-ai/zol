import { authorized } from "@/lib/api-server";
import { runCompanyBrainAgent } from "@/lib/ai/companyBrainAgent";
import { getCompanyBrainModel, getOpenAIClient } from "@/lib/ai/openai";
import { companyBrainTools, executeCompanyBrainTool } from "@/lib/ai/tools";
import { companyBrainRequestSchema } from "@/lib/validation/companyBrain";

export async function POST(request: Request) {
  return authorized(async () => {
    const { messages } = companyBrainRequestSchema.parse(await request.json());

    try {
      return await runCompanyBrainAgent({
        messages,
        openai: getOpenAIClient(),
        model: getCompanyBrainModel(),
        tools: companyBrainTools,
        executeTool: executeCompanyBrainTool,
      });
    } catch (error) {
      console.error("Company Brain request failed", error);
      if (
        error instanceof Error &&
        error.message.startsWith("Company Brain is not configured")
      ) {
        throw error;
      }
      throw new Error("Company Brain could not answer right now. Please try again.");
    }
  });
}
