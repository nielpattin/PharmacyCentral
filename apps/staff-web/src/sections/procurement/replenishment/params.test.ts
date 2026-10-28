import { describe, expect, it } from "vitest";

import {
  SUGGESTION_PARAM_DEFAULTS,
  SUGGESTION_PARAM_KEYS,
  SUGGESTION_PARAM_RULES,
  parseSuggestionParam,
  readSuggestionParams,
} from "./params.ts";

describe("parseSuggestionParam", () => {
  it("accepts whole numbers inside the range, ignoring surrounding spaces", () => {
    expect(parseSuggestionParam("windowDays", "30")).toBe(30);
    expect(parseSuggestionParam("windowDays", " 7 ")).toBe(7);
    expect(parseSuggestionParam("windowDays", "180")).toBe(180);
    expect(parseSuggestionParam("safetyDays", "0")).toBe(0);
  });

  it("refuses values outside the key's range", () => {
    expect(parseSuggestionParam("windowDays", "6")).toBeUndefined();
    expect(parseSuggestionParam("windowDays", "181")).toBeUndefined();
    expect(parseSuggestionParam("coverDays", "0")).toBeUndefined();
    expect(parseSuggestionParam("coverDays", "91")).toBeUndefined();
    expect(parseSuggestionParam("safetyDays", "61")).toBeUndefined();
    expect(parseSuggestionParam("defaultLeadTimeDays", "0")).toBeUndefined();
  });

  it("refuses fractions, signs, exponents, words and blanks", () => {
    for (const value of ["7.5", "-1", "1e2", "abc", "", "   ", "+7"]) {
      expect(parseSuggestionParam("windowDays", value), value).toBeUndefined();
    }
  });
});

describe("SUGGESTION_PARAM_DEFAULTS", () => {
  it.each(SUGGESTION_PARAM_KEYS)("matches the rule default for %s, inside its range", (key) => {
    const rule = SUGGESTION_PARAM_RULES[key];
    expect(SUGGESTION_PARAM_DEFAULTS[key]).toBe(String(rule.defaultValue));
    expect(rule.defaultValue).toBeGreaterThanOrEqual(rule.min);
    expect(rule.defaultValue).toBeLessThanOrEqual(rule.max);
  });

  it("uses the design's defaults: 30, 14, 7 and 7", () => {
    expect(SUGGESTION_PARAM_DEFAULTS).toEqual({
      windowDays: "30",
      coverDays: "14",
      safetyDays: "7",
      defaultLeadTimeDays: "7",
    });
  });
});

describe("readSuggestionParams", () => {
  it("returns the four numbers when every value is valid", () => {
    expect(readSuggestionParams({ ...SUGGESTION_PARAM_DEFAULTS })).toEqual({
      ok: true,
      params: { windowDays: 30, coverDays: 14, safetyDays: 7, defaultLeadTimeDays: 7 },
    });
  });

  it("names every key that is not valid, and only those", () => {
    expect(readSuggestionParams({ ...SUGGESTION_PARAM_DEFAULTS, windowDays: "2", defaultLeadTimeDays: "" })).toEqual({
      ok: false,
      invalid: ["windowDays", "defaultLeadTimeDays"],
    });
  });
});
