import { z } from "zod";

import type {
  ChatCompletion,
  ChatCompletionInput,
  ChatModel,
  ChatToolResult,
  ChatUsage,
} from "../domain/chat-model.ts";
import { ChatModelError } from "../domain/chat-model.ts";

export type GeminiSettings = { baseUrl: string; model: string; apiKey: string };

const REQUEST_TIMEOUT_MS = 30_000;

const tokenCountSchema = z.number().int().nonnegative();

/**
 * Gemini rejects a function-call turn without its `thoughtSignature`. The loose object keeps unknown keys, so each part
 * goes back to Gemini exactly as received.
 */
const geminiPartSchema = z.looseObject({
  text: z.string().optional(),
  thought: z.boolean().optional(),
  functionCall: z
    .looseObject({
      id: z.string().optional(),
      name: z.string(),
      args: z.unknown().optional(),
    })
    .optional(),
});

const geminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z.object({ parts: z.array(geminiPartSchema).optional() }).optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z
    .object({
      promptTokenCount: tokenCountSchema.optional(),
      cachedContentTokenCount: tokenCountSchema.optional(),
      candidatesTokenCount: tokenCountSchema.optional(),
      thoughtsTokenCount: tokenCountSchema.optional(),
    })
    .optional(),
});

type GeminiResponse = z.infer<typeof geminiResponseSchema>;
type GeminiPart = Record<string, unknown>;
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

const NO_USAGE: ChatUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, thoughtTokens: 0 };

/**
 * The key goes only in a header. Conversation text never reaches a log line or an error message.
 */
export class GeminiChatModel implements ChatModel {
  public constructor(private readonly options: GeminiSettings) {}

  public async complete(input: ChatCompletionInput): Promise<ChatCompletion> {
    const hasTools = input.tools.length > 0;
    const declarations = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.parameters,
    }));
    const contents: GeminiContent[] = input.turns.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    }));

    let modelCalls = 0;
    // A call without usageMetadata makes the total undefined. A partial sum would under-report the bill.
    let usage: ChatUsage | undefined = NO_USAGE;
    // Gemini's implicit cache needs an identical request prefix. The final round keeps the tools declared, with mode NONE.
    for (let round = 0; ; round++) {
      const toolsEnabled = round < input.maxToolRounds;
      const response = await this.post({
        systemInstruction: { parts: [{ text: input.systemInstruction }] },
        contents,
        ...(hasTools
          ? {
              tools: [{ functionDeclarations: declarations }],
              toolConfig: { functionCallingConfig: { mode: toolsEnabled ? "AUTO" : "NONE" } },
            }
          : {}),
        generationConfig: { temperature: 0.3 },
      });
      modelCalls += 1;
      const callUsage = toUsage(response.usageMetadata);
      usage =
        usage && callUsage
          ? {
              inputTokens: usage.inputTokens + callUsage.inputTokens,
              cachedInputTokens: usage.cachedInputTokens + callUsage.cachedInputTokens,
              outputTokens: usage.outputTokens + callUsage.outputTokens,
              thoughtTokens: usage.thoughtTokens + callUsage.thoughtTokens,
            }
          : undefined;

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const calls = parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []));
      if (calls.length > 0 && toolsEnabled) {
        contents.push({ role: "model", parts });
        const functionResponses: GeminiPart[] = [];
        for (const call of calls) {
          const result: ChatToolResult = await input.runTool({ name: call.name, args: call.args ?? {} });
          functionResponses.push({
            functionResponse: {
              ...(call.id !== undefined ? { id: call.id } : {}),
              name: call.name,
              response: result,
            },
          });
        }
        contents.push({ role: "user", parts: functionResponses });
        continue;
      }

      const text = parts
        .filter((part) => part.thought !== true)
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!text) {
        throw new ChatModelError(`Gemini returned no text (finish reason ${candidate?.finishReason})`);
      }
      return { text, usage, modelCalls };
    }
  }

  private async post(body: unknown): Promise<GeminiResponse> {
    const url = new URL(
      `/v1beta/models/${encodeURIComponent(this.options.model)}:generateContent`,
      this.options.baseUrl,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new ChatModelError("Gemini request failed", { cause });
    }
    if (!response.ok) {
      throw new ChatModelError(`Gemini answered HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ChatModelError("Gemini returned a non-JSON response");
    }
    const parsed = geminiResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ChatModelError("Gemini returned an unexpected response shape");
    }
    if (parsed.data.promptFeedback?.blockReason) {
      throw new ChatModelError(`Gemini blocked the question: ${parsed.data.promptFeedback.blockReason}`);
    }
    return parsed.data;
  }
}

function toUsage(metadata: GeminiResponse["usageMetadata"]): ChatUsage | undefined {
  if (!metadata) {
    return undefined;
  }
  return {
    inputTokens: metadata.promptTokenCount ?? 0,
    cachedInputTokens: metadata.cachedContentTokenCount ?? 0,
    outputTokens: metadata.candidatesTokenCount ?? 0,
    thoughtTokens: metadata.thoughtsTokenCount ?? 0,
  };
}
