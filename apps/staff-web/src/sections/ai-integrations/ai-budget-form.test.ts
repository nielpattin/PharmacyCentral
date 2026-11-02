import { describe, expect, it } from "vitest";

import {
  formatLimit,
  formatUsd,
  limitBody,
  limitFormFrom,
  parseUsd,
  priceBody,
  priceFormFrom,
  type AiBudgetView,
  type ConfiguredModel,
} from "./ai-budget-form.ts";

const model = (price: ConfiguredModel["price"]): ConfiguredModel => ({
  purpose: "chatbot",
  label: "Shopping assistant",
  provider: "gemini",
  model: "example-model-1",
  price,
});

const view = (limits: AiBudgetView["limits"]): AiBudgetView => ({
  timezone: "Asia/Ho_Chi_Minh",
  limits,
  spend: { todayUsd: 0, monthUsd: 0, todayStart: "2026-11-14T17:00:00.000Z", monthStart: "2026-10-31T17:00:00.000Z" },
  models: [],
});

describe("parseUsd", () => {
  it("reads a decimal amount with up to six places", () => {
    expect(parseUsd("1.25")).toEqual({ kind: "ok", value: 1.25 });
    expect(parseUsd(" 0.000001 ")).toEqual({ kind: "ok", value: 0.000001 });
  });

  it("treats a blank field as empty, not as zero", () => {
    expect(parseUsd("   ")).toEqual({ kind: "empty" });
  });

  it("rejects signs, separators, letters and a seventh decimal", () => {
    for (const text of ["-1", "1,5", "1e3", "abc", "0.0000001", "."]) {
      expect(parseUsd(text)).toEqual({ kind: "invalid" });
    }
  });
});

describe("limit form", () => {
  it("shows an unset limit as a blank field and a set limit as its amount", () => {
    expect(limitFormFrom(view({ dailyUsd: null, monthlyUsd: 120.5 }))).toEqual({ daily: "", monthly: "120.5" });
  });

  it("sends a blank field as no limit and a typed amount as the limit", () => {
    expect(limitBody({ daily: "", monthly: "50" })).toEqual({ dailyLimitUsd: null, monthlyLimitUsd: 50 });
  });

  it("sends nothing while a typed limit is invalid", () => {
    expect(limitBody({ daily: "5.1234567", monthly: "" })).toBeUndefined();
  });
});

describe("price form", () => {
  it("starts an unpriced model with blank fields, so no price is guessed", () => {
    expect(priceFormFrom(model(null))).toEqual({ input: "", output: "", image: "" });
  });

  it("builds the body with the model identity, and sends a blank image price as null", () => {
    expect(priceBody(model(null), { input: "1.25", output: "10", image: "" })).toEqual({
      provider: "gemini",
      model: "example-model-1",
      inputUsdPerMillion: 1.25,
      outputUsdPerMillion: 10,
      imageUsdPerImage: null,
    });
  });

  it("requires the input and the output price", () => {
    expect(priceBody(model(null), { input: "1.25", output: "", image: "" })).toBeUndefined();
    expect(priceBody(model(null), { input: "", output: "10", image: "" })).toBeUndefined();
  });

  it("rejects an invalid optional image price", () => {
    expect(priceBody(model(null), { input: "1", output: "2", image: "x" })).toBeUndefined();
  });
});

describe("formatting", () => {
  it("prints the amount without trailing zeros", () => {
    expect(formatUsd(1.5)).toBe("$1.5");
    expect(formatUsd(0.075)).toBe("$0.075");
  });

  it("prints the unlimited text for a null limit", () => {
    expect(formatLimit(null, "No limit")).toBe("No limit");
    expect(formatLimit(2, "No limit")).toBe("$2");
  });
});
