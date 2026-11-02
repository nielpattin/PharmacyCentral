import { describe, expect, it } from "vitest";

import type { ChatCompletionInput, ChatModel } from "../../domain/chat-model.ts";
import type { IntentClassifier } from "../../domain/intent-gate.ts";
import { AiBudgetExceededError } from "./ai-budget-errors.ts";
import { AiBudgetGuard } from "./ai-budget-guard.ts";
import type { AiBudgetStore, ModelPriceRow, SpendLimits, UsageRecord } from "./ai-budget-store.ts";
import { ConcurrencyLimiter } from "./concurrency-limiter.ts";
import {
  BudgetedChatModel,
  BudgetedIntentClassifier,
  CHAT_OUTPUT_TOKENS_PER_ROUND,
  CHAT_TOOL_RESULT_CHARS_PER_QUESTION,
  GATE_OUTPUT_TOKENS,
  GATE_PROMPT_CHARS,
  estimateChatCall,
  estimateGateCall,
} from "./budgeted-ai.ts";

const CHAT_IDENTITY = { purpose: "chatbot", provider: "gemini", model: "example-model-1" };
const GATE_IDENTITY = { purpose: "intent-gate", provider: "typesafe", model: "jev-latest" };
const NOW = new Date("2026-11-15T10:00:00.000Z");

const price = (provider: string, model: string): ModelPriceRow => ({
  provider,
  model,
  inputMicroUsdPerMillion: 1_000_000,
  outputMicroUsdPerMillion: 2_000_000,
  imageMicroUsdPerImage: null,
  updatedAt: NOW,
  updatedBy: "admin",
});

const memoryStore = (limits: SpendLimits, prices: ModelPriceRow[]) => {
  const ledger: UsageRecord[] = [];
  const store: AiBudgetStore = {
    findPrice: async (provider, model) => prices.find((row) => row.provider === provider && row.model === model),
    savePrice: async () => undefined,
    findLimits: async () => limits,
    saveLimits: async () => undefined,
    spendSince: async () => ledger.reduce((total, row) => total + (row.costMicroUsd ?? 0), 0),
    recordUsage: async (record) => {
      ledger.push(record);
    },
  };
  return { store, ledger };
};

const chatInput = (overrides: Partial<ChatCompletionInput> = {}): ChatCompletionInput => ({
  systemInstruction: "rules",
  turns: [{ role: "user", content: "hello" }],
  tools: [],
  runTool: async () => ({ error: "unknown_tool" }),
  maxToolRounds: 2,
  ...overrides,
});

describe("estimateChatCall", () => {
  it("counts the prompt once per model round and reserves tool results and output for each round", () => {
    const input = chatInput({ systemInstruction: "x".repeat(100), turns: [{ role: "user", content: "y".repeat(50) }] });
    const rounds = input.maxToolRounds + 1;
    const promptChars = 100 + 50 + JSON.stringify([]).length;

    expect(estimateChatCall(input)).toEqual({
      inputTokens: rounds * promptChars + CHAT_TOOL_RESULT_CHARS_PER_QUESTION * rounds,
      outputTokens: rounds * CHAT_OUTPUT_TOKENS_PER_ROUND,
    });
  });
});

describe("estimateGateCall", () => {
  it("counts the question, the previous exchange and the screening prompt", () => {
    expect(estimateGateCall({ question: "abc", previousQuestion: "de", previousReply: undefined })).toEqual({
      inputTokens: 3 + 2 + GATE_PROMPT_CHARS,
      outputTokens: GATE_OUTPUT_TOKENS,
    });
  });
});

describe("BudgetedChatModel", () => {
  it("records the provider usage with the call count of the whole question", async () => {
    const { store, ledger } = memoryStore({ dailyMicroUsd: null, monthlyMicroUsd: null }, [
      price("gemini", "example-model-1"),
    ]);
    const inner: ChatModel = {
      complete: async () => ({
        text: "answer",
        usage: { inputTokens: 300, cachedInputTokens: 0, outputTokens: 100, thoughtTokens: 50 },
        modelCalls: 3,
      }),
    };
    const model = new BudgetedChatModel(inner, CHAT_IDENTITY, guard(store));

    const completion = await model.complete(chatInput());

    expect(completion.text).toBe("answer");
    expect(ledger[0]).toMatchObject({
      usageSource: "provider",
      inputTokens: 300,
      outputTokens: 100,
      thoughtTokens: 50,
      modelCalls: 3,
      // 300 input at $1 per 1M plus 150 output at $2 per 1M is 600 micro-USD.
      costMicroUsd: 600,
    });
  });

  it("records an estimated usage when the provider returned none", async () => {
    const { store, ledger } = memoryStore({ dailyMicroUsd: null, monthlyMicroUsd: null }, [
      price("gemini", "example-model-1"),
    ]);
    const inner: ChatModel = { complete: async () => ({ text: "answer", usage: undefined, modelCalls: 1 }) };
    const model = new BudgetedChatModel(inner, CHAT_IDENTITY, guard(store));

    await model.complete(chatInput());

    expect(ledger[0]).toMatchObject({ usageSource: "estimated", modelCalls: 1 });
  });

  it("refuses before the provider is called when the daily limit is reached", async () => {
    const { store } = memoryStore({ dailyMicroUsd: 1, monthlyMicroUsd: null }, [price("gemini", "example-model-1")]);
    let called = false;
    const inner: ChatModel = {
      complete: async () => {
        called = true;
        return { text: "answer", usage: undefined, modelCalls: 1 };
      },
    };
    const model = new BudgetedChatModel(inner, CHAT_IDENTITY, guard(store));

    await expect(model.complete(chatInput())).rejects.toBeInstanceOf(AiBudgetExceededError);
    expect(called).toBe(false);
  });
});

describe("BudgetedIntentClassifier", () => {
  it("records every screening call from its estimate, because the API reports no usage", async () => {
    const { store, ledger } = memoryStore({ dailyMicroUsd: null, monthlyMicroUsd: null }, [
      price("typesafe", "jev-latest"),
    ]);
    const inner: IntentClassifier = {
      classify: async () => ({ intent: "greeting", intentConfidence: null, emergency: 0, injection: 0 }),
    };
    const classifier = new BudgetedIntentClassifier(inner, GATE_IDENTITY, guard(store));

    const verdict = await classifier.classify({
      question: "hi",
      previousQuestion: undefined,
      previousReply: undefined,
    });

    expect(verdict.intent).toBe("greeting");
    expect(ledger[0]).toMatchObject({
      purpose: "intent-gate",
      usageSource: "estimated",
      inputTokens: 2 + GATE_PROMPT_CHARS,
      outputTokens: GATE_OUTPUT_TOKENS,
    });
  });
});

const guard = (store: AiBudgetStore): AiBudgetGuard =>
  new AiBudgetGuard({ store, limiter: new ConcurrencyLimiter(4, 1_000), clock: () => NOW });
