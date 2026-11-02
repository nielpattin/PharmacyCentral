import type { ChatCompletion, ChatCompletionInput, ChatModel } from "../../domain/chat-model.ts";
import type { IntentClassifier, IntentGateInput, IntentVerdict } from "../../domain/intent-gate.ts";
import { AiBudgetGuard, type BudgetIdentity, type CallEstimate } from "./ai-budget-guard.ts";

/**
 * Upper bounds for the reservation. Characters count as tokens, which over-counts for both Vietnamese and English text,
 * so the reservation stays on the safe side. The ledger uses the provider's own count whenever it sends one.
 */
export const CHAT_OUTPUT_TOKENS_PER_ROUND = 4_096;
export const CHAT_TOOL_RESULT_CHARS_PER_QUESTION = 16_000;
export const GATE_PROMPT_CHARS = 4_000;
export const GATE_OUTPUT_TOKENS = 512;

export const estimateChatCall = (input: ChatCompletionInput): CallEstimate => {
  // Each model round re-sends the whole conversation, so the prompt is counted once per round.
  const rounds = input.maxToolRounds + 1;
  const promptChars =
    input.systemInstruction.length +
    input.turns.reduce((total, turn) => total + turn.content.length, 0) +
    JSON.stringify(input.tools).length;
  return {
    inputTokens: rounds * promptChars + CHAT_TOOL_RESULT_CHARS_PER_QUESTION * rounds,
    outputTokens: rounds * CHAT_OUTPUT_TOKENS_PER_ROUND,
  };
};

export const estimateGateCall = (input: IntentGateInput): CallEstimate => ({
  inputTokens:
    input.question.length +
    (input.previousQuestion?.length ?? 0) +
    (input.previousReply?.length ?? 0) +
    GATE_PROMPT_CHARS,
  outputTokens: GATE_OUTPUT_TOKENS,
});

/** Wraps one chat provider adapter. The identity comes from the same settings snapshot the adapter was built from. */
export class BudgetedChatModel implements ChatModel {
  public constructor(
    private readonly inner: ChatModel,
    private readonly identity: BudgetIdentity,
    private readonly guard: AiBudgetGuard,
  ) {}

  public complete(input: ChatCompletionInput): Promise<ChatCompletion> {
    return this.guard.run(this.identity, estimateChatCall(input), async () => {
      const completion = await this.inner.complete(input);
      return {
        value: completion,
        usage:
          completion.usage === undefined
            ? undefined
            : {
                inputTokens: completion.usage.inputTokens,
                cachedInputTokens: completion.usage.cachedInputTokens,
                outputTokens: completion.usage.outputTokens,
                thoughtTokens: completion.usage.thoughtTokens,
                modelCalls: completion.modelCalls,
              },
      };
    });
  }
}

/** Wraps the screening adapter. Its API returns no usage, so every call is recorded from the estimate. */
export class BudgetedIntentClassifier implements IntentClassifier {
  public constructor(
    private readonly inner: IntentClassifier,
    private readonly identity: BudgetIdentity,
    private readonly guard: AiBudgetGuard,
  ) {}

  public classify(input: IntentGateInput): Promise<IntentVerdict> {
    return this.guard.run(this.identity, estimateGateCall(input), async () => ({
      value: await this.inner.classify(input),
      usage: undefined,
    }));
  }
}
