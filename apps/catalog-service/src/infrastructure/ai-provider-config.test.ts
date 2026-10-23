import { describe, expect, it } from "vitest";

import { readAiProviderSettings } from "./ai-provider-config.ts";

const featureEnv = {
  AI_FEATURE_PROVIDER: "gemini",
  AI_FEATURE_MODEL: "example-model-1",
  AI_FEATURE_BASE_URL: "https://provider.example.test",
  AI_FEATURE_API_KEY: "example-key-1234",
};

describe("readAiProviderSettings", () => {
  it("reads the variables of the purpose it is asked for", () => {
    expect(readAiProviderSettings("feature", featureEnv)).toEqual({
      provider: "gemini",
      model: "example-model-1",
      baseUrl: "https://provider.example.test",
      apiKey: "example-key-1234",
    });
  });

  it("maps a hyphenated purpose to underscored variable names", () => {
    const env = {
      AI_MY_FEATURE_PROVIDER: "gemini",
      AI_MY_FEATURE_MODEL: "example-model-1",
      AI_MY_FEATURE_BASE_URL: "https://provider.example.test",
      AI_MY_FEATURE_API_KEY: "example-key-1234",
    };

    expect(readAiProviderSettings("my-feature", env)).toMatchObject({ model: "example-model-1" });
  });

  it("doesn't consume AI variables that belong to another purpose", () => {
    expect(readAiProviderSettings("other", featureEnv)).toBeUndefined();
  });

  it("returns no settings when nothing is set", () => {
    expect(readAiProviderSettings("feature", {})).toBeUndefined();
  });

  it.each([undefined, "", "   "])("treats blank variables as unset when all four are blank", (blank) => {
    const env = {
      AI_FEATURE_PROVIDER: blank,
      AI_FEATURE_MODEL: blank,
      AI_FEATURE_BASE_URL: blank,
      AI_FEATURE_API_KEY: blank,
    };

    expect(readAiProviderSettings("feature", env)).toBeUndefined();
  });

  it.each(["PROVIDER", "MODEL", "BASE_URL", "API_KEY"])(
    "refuses a blank AI_FEATURE_%s among three set variables and names only that variable",
    (variable) => {
      const env = { ...featureEnv, [`AI_FEATURE_${variable}`]: "" };

      expect(() => readAiProviderSettings("feature", env)).toThrow(
        `Incomplete AI settings for feature: set AI_FEATURE_${variable} or leave all four AI_FEATURE_* unset.`,
      );
    },
  );

  it("trims surrounding whitespace", () => {
    const env = {
      AI_FEATURE_PROVIDER: "  gemini  ",
      AI_FEATURE_MODEL: " example-model-1 ",
      AI_FEATURE_BASE_URL: " https://provider.example.test ",
      AI_FEATURE_API_KEY: "  key-12345678  ",
    };

    expect(readAiProviderSettings("feature", env)).toEqual({
      provider: "gemini",
      model: "example-model-1",
      baseUrl: "https://provider.example.test",
      apiKey: "key-12345678",
    });
  });

  it.each(["PROVIDER", "MODEL", "BASE_URL", "API_KEY"])(
    "refuses a partially set group and names AI_FEATURE_%s",
    (variable) => {
      const env: Record<string, string | undefined> = { ...featureEnv, [`AI_FEATURE_${variable}`]: undefined };

      expect(() => readAiProviderSettings("feature", env)).toThrow(`AI_FEATURE_${variable}`);
    },
  );

  it("treats a whitespace-only variable as missing and names it", () => {
    const env = { ...featureEnv, AI_FEATURE_API_KEY: "  " };

    expect(() => readAiProviderSettings("feature", env)).toThrow(/AI_FEATURE_API_KEY/);
  });

  it("names every missing variable of a partial group in one error", () => {
    const env = {
      AI_FEATURE_PROVIDER: "gemini",
      AI_FEATURE_MODEL: "example-model-1",
      AI_FEATURE_BASE_URL: "   ",
      AI_FEATURE_API_KEY: "  ",
    };

    expect(() => readAiProviderSettings("feature", env)).toThrow(
      "Incomplete AI settings for feature: set AI_FEATURE_BASE_URL, AI_FEATURE_API_KEY or leave all four AI_FEATURE_* unset.",
    );
  });

  it("refuses a provider that has no adapter and says which variable held it", () => {
    const env = {
      ...featureEnv,
      AI_FEATURE_PROVIDER: "openai",
    };

    expect(() => readAiProviderSettings("feature", env)).toThrow(
      'AI_FEATURE_PROVIDER is "openai", which has no adapter. Supported: gemini, openai-compatible.',
    );
  });
});
