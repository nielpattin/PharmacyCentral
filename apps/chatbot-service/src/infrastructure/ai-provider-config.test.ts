import { describe, expect, it } from "vitest";

import { readAiProviderSettings } from "./ai-provider-config.ts";

const chatbotEnv = {
  AI_CHATBOT_PROVIDER: "gemini",
  AI_CHATBOT_MODEL: "example-model-1",
  AI_CHATBOT_BASE_URL: "https://provider.example.test",
  AI_CHATBOT_API_KEY: "example-key-1234",
};

const gateEnv = {
  AI_INTENT_GATE_PROVIDER: "typesafe",
  AI_INTENT_GATE_MODEL: "jev-latest",
  AI_INTENT_GATE_BASE_URL: "https://provider.example.test",
  AI_INTENT_GATE_API_KEY: "example-key-1234",
};

describe("readAiProviderSettings", () => {
  it("reads the variables of the purpose it is asked for", () => {
    expect(readAiProviderSettings("chatbot", chatbotEnv)).toEqual({
      provider: "gemini",
      model: "example-model-1",
      baseUrl: "https://provider.example.test",
      apiKey: "example-key-1234",
    });
    expect(readAiProviderSettings("intent-gate", gateEnv)).toEqual({
      provider: "typesafe",
      model: "jev-latest",
      baseUrl: "https://provider.example.test",
      apiKey: "example-key-1234",
    });
  });

  it("accepts openai-compatible for the chatbot and keeps the base URL with its version path", () => {
    const env = {
      AI_CHATBOT_PROVIDER: "openai-compatible",
      AI_CHATBOT_MODEL: "example-model",
      AI_CHATBOT_BASE_URL: "https://llm.example.com/v1",
      AI_CHATBOT_API_KEY: "example-key-1234",
    };

    expect(readAiProviderSettings("chatbot", env)).toEqual({
      provider: "openai-compatible",
      model: "example-model",
      baseUrl: "https://llm.example.com/v1",
      apiKey: "example-key-1234",
    });
  });

  it("doesn't consume AI variables that belong to another purpose", () => {
    expect(readAiProviderSettings("intent-gate", chatbotEnv)).toBeUndefined();
    expect(readAiProviderSettings("chatbot", gateEnv)).toBeUndefined();
  });

  it("returns no settings when nothing is set", () => {
    expect(readAiProviderSettings("chatbot", {})).toBeUndefined();
    expect(readAiProviderSettings("intent-gate", {})).toBeUndefined();
  });

  it.each([undefined, "", "   "])("treats blank variables as unset when all four are blank", (blank) => {
    const env = {
      AI_INTENT_GATE_PROVIDER: blank,
      AI_INTENT_GATE_MODEL: blank,
      AI_INTENT_GATE_BASE_URL: blank,
      AI_INTENT_GATE_API_KEY: blank,
    };

    expect(readAiProviderSettings("intent-gate", env)).toBeUndefined();
  });

  it.each(["PROVIDER", "MODEL", "BASE_URL", "API_KEY"])(
    "refuses a blank AI_INTENT_GATE_%s among three set variables and names only that variable",
    (variable) => {
      const env = { ...gateEnv, [`AI_INTENT_GATE_${variable}`]: "" };

      expect(() => readAiProviderSettings("intent-gate", env)).toThrow(
        `Incomplete AI settings for intent-gate: set AI_INTENT_GATE_${variable} or leave all four AI_INTENT_GATE_* unset.`,
      );
    },
  );

  it("trims surrounding whitespace", () => {
    const env = {
      AI_INTENT_GATE_PROVIDER: "  typesafe  ",
      AI_INTENT_GATE_MODEL: " jev-latest ",
      AI_INTENT_GATE_BASE_URL: " https://provider.example.test ",
      AI_INTENT_GATE_API_KEY: "  key-12345678  ",
    };

    expect(readAiProviderSettings("intent-gate", env)).toEqual({
      provider: "typesafe",
      model: "jev-latest",
      baseUrl: "https://provider.example.test",
      apiKey: "key-12345678",
    });
  });

  it.each(["PROVIDER", "MODEL", "BASE_URL", "API_KEY"])(
    "refuses a partially set group and names AI_CHATBOT_%s",
    (variable) => {
      const env: Record<string, string | undefined> = { ...chatbotEnv, [`AI_CHATBOT_${variable}`]: undefined };

      expect(() => readAiProviderSettings("chatbot", env)).toThrow(`AI_CHATBOT_${variable}`);
    },
  );

  it("treats a whitespace-only variable as missing and names it", () => {
    const env = { ...gateEnv, AI_INTENT_GATE_API_KEY: "  " };

    expect(() => readAiProviderSettings("intent-gate", env)).toThrow(/AI_INTENT_GATE_API_KEY/);
  });

  it("names every missing variable of a partial group in one error", () => {
    const env = {
      AI_INTENT_GATE_PROVIDER: "typesafe",
      AI_INTENT_GATE_MODEL: "jev-latest",
      AI_INTENT_GATE_BASE_URL: "   ",
      AI_INTENT_GATE_API_KEY: "  ",
    };

    expect(() => readAiProviderSettings("intent-gate", env)).toThrow(
      "Incomplete AI settings for intent-gate: set AI_INTENT_GATE_BASE_URL, AI_INTENT_GATE_API_KEY or leave all four AI_INTENT_GATE_* unset.",
    );
  });

  it.each([
    { purpose: "chatbot" as const, prefix: "AI_CHATBOT", provider: "openai", supported: "gemini, openai-compatible" },
    {
      purpose: "chatbot" as const,
      prefix: "AI_CHATBOT",
      provider: "typesafe",
      supported: "gemini, openai-compatible",
    },
    { purpose: "intent-gate" as const, prefix: "AI_INTENT_GATE", provider: "gemini", supported: "typesafe" },
    { purpose: "intent-gate" as const, prefix: "AI_INTENT_GATE", provider: "openai", supported: "typesafe" },
  ])(
    "refuses $provider for $purpose and lists only the providers of that purpose",
    ({ purpose, prefix, provider, supported }) => {
      const env = {
        [`${prefix}_PROVIDER`]: provider,
        [`${prefix}_MODEL`]: "example-model-1",
        [`${prefix}_BASE_URL`]: "https://provider.example.test",
        [`${prefix}_API_KEY`]: "example-key-1234",
      };

      expect(() => readAiProviderSettings(purpose, env)).toThrow(
        `${prefix}_PROVIDER is "${provider}", which has no adapter for ${purpose}. Supported: ${supported}.`,
      );
    },
  );
});
