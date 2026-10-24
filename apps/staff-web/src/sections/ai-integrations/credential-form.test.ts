import { describe, expect, it } from "vitest";

import type { CredentialView } from "./features.ts";
import {
  canSaveForm,
  initialFormState,
  isFormDirty,
  nextBaseUrlOnProviderChange,
  settingsBody,
} from "./credential-form.ts";

const providers = [
  { id: "gemini", label: "Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com" },
  { id: "openai-compatible", label: "OpenAI compatible", defaultBaseUrl: "https://llm.example.com/v1" },
];

const stored: CredentialView = {
  providers,
  current: {
    configured: true,
    source: "stored",
    provider: "gemini",
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com",
    last4: "1234",
    updatedAt: "2026-10-20T08:00:00.000Z",
    updatedBy: "admin",
    environmentFallback: false,
  },
};

const unconfigured: CredentialView = { providers, current: { configured: false } };

describe("initialFormState", () => {
  it("loads the saved settings but never the key", () => {
    expect(initialFormState(stored)).toEqual({
      provider: "gemini",
      model: "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "",
      baseUrlEdited: false,
    });
  });

  it("starts an unconfigured feature on the first provider's default", () => {
    expect(initialFormState(unconfigured)).toMatchObject({
      provider: "gemini",
      model: "",
      baseUrl: "https://generativelanguage.googleapis.com",
    });
  });
});

describe("nextBaseUrlOnProviderChange", () => {
  it("follows the new provider's default until the admin types a base URL", () => {
    const form = initialFormState(stored);
    expect(nextBaseUrlOnProviderChange(form, "openai-compatible", providers)).toBe("https://llm.example.com/v1");
    expect(nextBaseUrlOnProviderChange({ ...form, baseUrlEdited: true }, "openai-compatible", providers)).toBe(
      form.baseUrl,
    );
  });

  it("ignores an unknown provider", () => {
    expect(nextBaseUrlOnProviderChange(initialFormState(stored), "unknown", providers)).toBeUndefined();
  });
});

describe("isFormDirty", () => {
  it("is clean until a field differs, and a typed key always counts", () => {
    const baseline = initialFormState(stored);
    expect(isFormDirty(baseline, baseline)).toBe(false);
    expect(isFormDirty({ ...baseline, model: "gemini-2.5-pro" }, baseline)).toBe(true);
    expect(isFormDirty({ ...baseline, apiKey: "   " }, baseline)).toBe(false);
    expect(isFormDirty({ ...baseline, apiKey: "sk-new-key-value" }, baseline)).toBe(true);
  });
});

describe("canSaveForm", () => {
  it("keeps the saved key when the provider stays the same", () => {
    expect(canSaveForm(initialFormState(stored), stored.current)).toBe(true);
  });

  it("needs a new key of at least 8 characters when the provider changes", () => {
    const form = { ...initialFormState(stored), provider: "openai-compatible" };
    expect(canSaveForm({ ...form, apiKey: "short" }, stored.current)).toBe(false);
    expect(canSaveForm({ ...form, apiKey: "long-enough-key" }, stored.current)).toBe(true);
  });

  it("requires an https base URL and a model", () => {
    const form = initialFormState(stored);
    expect(canSaveForm({ ...form, baseUrl: "http://insecure.example.com" }, stored.current)).toBe(false);
    expect(canSaveForm({ ...form, model: "  " }, stored.current)).toBe(false);
  });
});

describe("settingsBody", () => {
  it("omits the key when none was typed, so the saved one is kept", () => {
    expect(settingsBody({ ...initialFormState(stored), model: " gemini-2.5-pro " })).toEqual({
      provider: "gemini",
      model: "gemini-2.5-pro",
      baseUrl: "https://generativelanguage.googleapis.com",
    });
  });

  it("sends the trimmed key when one was typed", () => {
    expect(settingsBody({ ...initialFormState(stored), apiKey: "  new-key-value  " })).toMatchObject({
      apiKey: "new-key-value",
    });
  });
});
