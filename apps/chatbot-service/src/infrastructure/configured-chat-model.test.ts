import { describe, expect, it } from "vitest";

import type { ChatCompletionInput, ChatModel } from "../domain/chat-model.ts";
import { ChatModelError } from "../domain/chat-model.ts";
import { createAdapterSource } from "../modules/credentials/ai-adapters.ts";
import type { AiProviderSettings } from "./ai-provider-config.ts";
import { ConfiguredChatModel } from "./configured-chat-model.ts";

const INPUT: ChatCompletionInput = {
  systemInstruction: "rules",
  turns: [{ role: "user", content: "Chào" }],
  tools: [],
  runTool: async () => ({ error: "unknown_tool" }),
  maxToolRounds: 2,
};
const SETTINGS: AiProviderSettings = {
  provider: "gemini",
  model: "example-model-1",
  baseUrl: "https://provider.example.test",
  apiKey: "example-key-1234",
};

describe("ConfiguredChatModel", () => {
  it("reports that no provider is configured when there are no settings", async () => {
    const model = new ConfiguredChatModel(createAdapterSource(async () => undefined, { gemini: () => fail() }));

    const failure = await model.complete(INPUT).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatModelError);
    expect(failure).toHaveProperty("message", "No AI provider is configured");
  });

  it("reports a failing settings read as a ChatModelError with the cause attached", async () => {
    const cause = new Error("database down");
    const model = new ConfiguredChatModel(
      createAdapterSource(
        async () => {
          throw cause;
        },
        { gemini: () => fail() },
      ),
    );

    const failure = await model.complete(INPUT).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ChatModelError);
    expect(failure).toHaveProperty("cause", cause);
  });

  it("answers through the adapter built from exactly the settings it read", async () => {
    const built: AiProviderSettings[] = [];
    const adapter: ChatModel = {
      complete: async () => ({ text: "Smecta giúp điều trị tiêu chảy.", usage: undefined, modelCalls: 1 }),
    };
    const model = new ConfiguredChatModel(
      createAdapterSource(async () => SETTINGS, {
        gemini: (settings) => {
          built.push(settings);
          return adapter;
        },
      }),
    );

    expect((await model.complete(INPUT)).text).toBe("Smecta giúp điều trị tiêu chảy.");
    expect(built).toEqual([SETTINGS]);
  });

  it("follows a settings change without being rebuilt", async () => {
    let current: AiProviderSettings | undefined = SETTINGS;
    const model = new ConfiguredChatModel(
      createAdapterSource(async () => current, {
        gemini: (settings) => ({
          complete: async () => ({ text: `answer from ${settings.model}`, usage: undefined, modelCalls: 1 }),
        }),
      }),
    );

    expect((await model.complete(INPUT)).text).toBe("answer from example-model-1");

    current = { ...SETTINGS, model: "example-model-2" };

    expect((await model.complete(INPUT)).text).toBe("answer from example-model-2");
    current = undefined;
    await expect(model.complete(INPUT)).rejects.toThrow("No AI provider is configured");
  });
});

const fail = (): ChatModel => {
  throw new Error("adapter built without settings");
};
