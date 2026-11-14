import { describe, expect, it } from "vitest";
import type { FunctionTool, ResponseInput } from "openai/resources/responses/responses";
import { runCompanyBrainAgent } from "../lib/ai/companyBrainAgent";

type CreateInput = {
  model: string;
  instructions: string;
  input: ResponseInput;
  tools: FunctionTool[];
  store: false;
  reasoning: { effort: "low" };
  max_output_tokens: number;
};

function lastToolOutput(input: ResponseInput) {
  const outputs = input.filter(
    (item) => typeof item === "object" && item !== null && item.type === "function_call_output",
  );
  const last = outputs.at(-1);
  if (!last || typeof last !== "object" || !("output" in last)) {
    throw new Error("Missing tool output");
  }
  return JSON.parse(String(last.output)) as { clients?: { total: number }; tasks?: { total: number } };
}

describe("Company Brain agent harness", () => {
  it("uses a workspace tool before answering factual count questions", async () => {
    const createCalls: CreateInput[] = [];
    const toolCalls: Array<{ name: string; argumentsJson: string }> = [];
    const openai = {
      responses: {
        create: async (input: CreateInput) => {
          createCalls.push(input);
          if (createCalls.length === 1) {
            return {
              output_text: "",
              output: [
                {
                  type: "function_call" as const,
                  call_id: "call_summary",
                  name: "get_workspace_summary",
                  arguments: "{}",
                },
              ],
            };
          }
          return {
            output: [],
            output_text: `There are ${lastToolOutput(input.input).tasks?.total} tasks.`,
          };
        },
      },
    };

    const result = await runCompanyBrainAgent({
      messages: [{ role: "user", content: "How many tasks are there?" }],
      openai,
      model: "test-model",
      tools: [],
      executeTool: async (name, argumentsJson) => {
        toolCalls.push({ name, argumentsJson });
        return { tasks: { total: 6 } };
      },
      now: () => new Date("2026-08-26T00:00:00.000Z"),
    });

    expect(toolCalls).toEqual([{ name: "get_workspace_summary", argumentsJson: "{}" }]);
    expect(createCalls).toHaveLength(2);
    expect(result).toEqual({
      answer: "There are 6 tasks.",
      generatedAt: "2026-08-26T00:00:00.000Z",
    });
  });
});

describe("Company Brain cross-memory harness", () => {
  it("answers from fresh tool output instead of stale conversation memory", async () => {
    let liveClientTotal = 2;
    const createToolBackedClient = () => {
      let round = 0;
      return {
        responses: {
          create: async (input: CreateInput) => {
            round += 1;
            if (round === 1) {
              return {
                output_text: "",
                output: [
                  {
                    type: "function_call" as const,
                    call_id: `call_clients_${liveClientTotal}`,
                    name: "get_workspace_summary",
                    arguments: "{}",
                  },
                ],
              };
            }
            return {
              output: [],
              output_text: `There are ${lastToolOutput(input.input).clients?.total} clients now.`,
            };
          },
        },
      };
    };

    const first = await runCompanyBrainAgent({
      messages: [{ role: "user", content: "How many clients are there?" }],
      openai: createToolBackedClient(),
      model: "test-model",
      tools: [],
      executeTool: async () => ({ clients: { total: liveClientTotal } }),
      now: () => new Date("2026-08-26T00:00:00.000Z"),
    });

    liveClientTotal = 4;
    const second = await runCompanyBrainAgent({
      messages: [
        { role: "user", content: "How many clients are there?" },
        { role: "assistant", content: first.answer },
        { role: "user", content: "Check again. How many clients are there now?" },
      ],
      openai: createToolBackedClient(),
      model: "test-model",
      tools: [],
      executeTool: async () => ({ clients: { total: liveClientTotal } }),
      now: () => new Date("2026-08-26T00:01:00.000Z"),
    });

    expect(first.answer).toBe("There are 2 clients now.");
    expect(second.answer).toBe("There are 4 clients now.");
  });
});
