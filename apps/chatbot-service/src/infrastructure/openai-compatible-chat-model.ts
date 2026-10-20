import { z } from "zod";

import type {
  ChatCompletion,
  ChatCompletionInput,
  ChatModel,
  ChatToolResult,
  ChatUsage,
} from "../domain/chat-model.ts";
import { ChatModelError } from "../domain/chat-model.ts";

export type OpenAiCompatibleSettings = { baseUrl: string; model: string; apiKey: string };

const REQUEST_TIMEOUT_MS = 30_000;

const tokenCountSchema = z.number().int().nonnegative();

const toolCallSchema = z.looseObject({
  id: z.string(),
  type: z.string().optional(),
  function: z.looseObject({ name: z.string(), arguments: z.string() }),
});

/**
 * Loose on purpose. The assistant message goes back to the provider exactly as received, so every key it sent is kept.
 */
const messageSchema = z.looseObject({
  content: z.string().nullable().optional(),
  tool_calls: z.array(toolCallSchema).nullish(),
});

const responseSchema = z.looseObject({
  // Only the first choice is read. The tuple's rest accepts any extra choices without reading them.
  choices: z.tuple([z.looseObject({ message: messageSchema, finish_reason: z.string().optional() })], z.unknown()),
  usage: z
    .looseObject({
      prompt_tokens: tokenCountSchema.nullish(),
      completion_tokens: tokenCountSchema.nullish(),
      prompt_tokens_details: z.looseObject({ cached_tokens: tokenCountSchema.nullish() }).nullish(),
      completion_tokens_details: z.looseObject({ reasoning_tokens: tokenCountSchema.nullish() }).nullish(),
    })
    .nullish(),
});

type OpenAiResponse = z.infer<typeof responseSchema>;
type OpenAiMessage = Record<string, unknown>;

const NO_USAGE: ChatUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, thoughtTokens: 0 };

/**
 * The key goes only in a header. Conversation text never reaches a log line or an error message.
 */
export class OpenAiCompatibleChatModel implements ChatModel {
  public constructor(private readonly options: OpenAiCompatibleSettings) {}

  public async complete(input: ChatCompletionInput): Promise<ChatCompletion> {
    const hasTools = input.tools.length > 0;
    const tools = input.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    const messages: OpenAiMessage[] = [
      { role: "system", content: input.systemInstruction },
      ...input.turns.map((turn) => ({ role: turn.role, content: turn.content })),
    ];

    let modelCalls = 0;
    // A call without a usage block makes the total undefined. A partial sum would under-report the bill.
    let usage: ChatUsage | undefined = NO_USAGE;
    // The provider's prefix cache needs an identical request prefix, so the tools stay declared on every round.
    // Only tool_choice changes, to "none" on the final round.
    for (let round = 0; ; round++) {
      const toolsEnabled = round < input.maxToolRounds;
      const response = await this.post({
        model: this.options.model,
        messages,
        ...(hasTools ? { tools, tool_choice: toolsEnabled ? "auto" : "none" } : {}),
        temperature: 0.3,
      });
      modelCalls += 1;
      const callUsage = toUsage(response.usage);
      usage =
        usage && callUsage
          ? {
              inputTokens: usage.inputTokens + callUsage.inputTokens,
              cachedInputTokens: usage.cachedInputTokens + callUsage.cachedInputTokens,
              outputTokens: usage.outputTokens + callUsage.outputTokens,
              thoughtTokens: usage.thoughtTokens + callUsage.thoughtTokens,
            }
          : undefined;

      const choice = response.choices[0];
      const message = choice.message;
      const calls = message.tool_calls ?? [];
      if (calls.length > 0 && toolsEnabled) {
        messages.push(message);
        for (const call of calls) {
          const result: ChatToolResult = await input.runTool({
            name: call.function.name,
            args: parseArguments(call.function.arguments),
          });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue;
      }

      const text = (message.content ?? "").trim();
      if (!text) {
        throw new ChatModelError(`OpenAI-compatible API returned no text (finish reason ${choice.finish_reason})`);
      }
      return { text, usage, modelCalls };
    }
  }

  private async post(body: unknown): Promise<OpenAiResponse> {
    // A string join keeps any path on the base URL. `new URL("/chat/completions", base)` would drop it.
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new ChatModelError("OpenAI-compatible request failed", { cause });
    }
    if (!response.ok) {
      throw new ChatModelError(`OpenAI-compatible API answered HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ChatModelError("OpenAI-compatible API returned a non-JSON response");
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ChatModelError("OpenAI-compatible API returned an unexpected response shape");
    }
    return parsed.data;
  }
}

/** Invalid JSON becomes undefined, so the use case answers invalid_arguments instead of failing the whole turn. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function toUsage(usage: OpenAiResponse["usage"]): ChatUsage | undefined {
  if (!usage) {
    return undefined;
  }
  // OpenAI counts reasoning tokens inside completion_tokens. The port reports them apart, so they are subtracted here.
  const thoughtTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: Math.max(0, (usage.completion_tokens ?? 0) - thoughtTokens),
    thoughtTokens,
  };
}
