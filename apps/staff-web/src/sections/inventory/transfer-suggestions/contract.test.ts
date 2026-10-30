import { describe, expect, it } from "vitest";

import { parseTransferSuggestions, suggestionsPath } from "./contract.ts";

const suggestion = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  productId: "product-1",
  sourceSiteId: "site-1",
  destinationSiteId: "site-2",
  quantity: 24,
  sourceAvailable: 120,
  sourceDaysOfCover: 60,
  destinationAvailable: 6,
  destinationDaysOfCover: 3,
  destinationDailyVelocity: 2,
  earliestExpiry: "2027-03-31",
  daysToExpiry: 152,
  cappedByExpiry: false,
  ...overrides,
});

const response = (rows: Array<Record<string, unknown>>): Record<string, unknown> => ({
  generatedAt: "2026-10-30T10:00:00.000Z",
  windowDays: 30,
  params: { keepCoverDays: 45, triggerCoverDays: 14, targetCoverDays: 30 },
  suggestions: rows,
});

describe("suggestionsPath", () => {
  it("builds the GET path with the sales window", () => {
    expect(suggestionsPath(30)).toBe("/api/inventory/transfer-suggestions?windowDays=30");
  });
});

describe("parseTransferSuggestions", () => {
  it("reads the contract shape, with a null source cover allowed", () => {
    const parsed = parseTransferSuggestions(response([suggestion(), suggestion({ sourceDaysOfCover: null })]));
    expect(parsed.windowDays).toBe(30);
    expect(parsed.params).toEqual({ keepCoverDays: 45, triggerCoverDays: 14, targetCoverDays: 30 });
    expect(parsed.suggestions).toHaveLength(2);
    expect(parsed.suggestions[1]).toMatchObject({ sourceDaysOfCover: null });
  });

  it("accepts an empty suggestion list", () => {
    expect(parseTransferSuggestions(response([])).suggestions).toEqual([]);
  });

  it("refuses a field renamed away from the contract", () => {
    const { quantity: _renamed, ...rest } = suggestion();
    expect(() => parseTransferSuggestions(response([{ ...rest, suggestedQuantity: 24 }]))).toThrow(
      "Unexpected transfer suggestions response.",
    );
  });

  it("refuses a cover figure of the wrong type", () => {
    expect(() => parseTransferSuggestions(response([suggestion({ destinationDaysOfCover: "3" })]))).toThrow(
      "Unexpected transfer suggestions response.",
    );
  });

  it("refuses an answer without the response fields", () => {
    expect(() =>
      parseTransferSuggestions({
        generatedAt: "2026-10-30T10:00:00.000Z",
        windowDays: 30,
        suggestions: [suggestion()],
      }),
    ).toThrow("Unexpected transfer suggestions response.");
  });
});
