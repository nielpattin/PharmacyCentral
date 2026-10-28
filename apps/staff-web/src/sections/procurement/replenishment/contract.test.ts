import { describe, expect, it } from "vitest";

import { parseDraftOrdersResponse, parseSuggestionsResponse, suggestionsPath } from "./contract.ts";

const suggestion = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  productId: "product-1",
  supplierId: "supplier-1",
  dailyVelocity: 2.5,
  dispensedQuantity: 75,
  onHand: 20,
  reserved: 2,
  available: 18,
  inboundQuantity: 0,
  minimumStock: 17.5,
  leadTimeDays: 7,
  leadTimeSource: "default",
  sampleCount: 0,
  reorderPoint: 35,
  targetStock: 70,
  suggestedQuantity: 52,
  daysOfCover: 7.2,
  ...overrides,
});

const response = (rows: Array<Record<string, unknown>>): Record<string, unknown> => ({
  siteId: "site-1",
  params: { windowDays: 30, coverDays: 14, safetyDays: 7, defaultLeadTimeDays: 7 },
  generatedAt: "2026-10-28T03:00:00.000Z",
  suggestions: rows,
});

describe("suggestionsPath", () => {
  it("builds the GET path with the site and the four parameters", () => {
    expect(
      suggestionsPath({
        siteId: "site-1",
        params: { windowDays: 30, coverDays: 14, safetyDays: 7, defaultLeadTimeDays: 7 },
      }),
    ).toBe(
      "/api/procurement/replenishment-suggestions?siteId=site-1&windowDays=30&coverDays=14&safetyDays=7&defaultLeadTimeDays=7",
    );
  });
});

describe("parseSuggestionsResponse", () => {
  it("reads the contract shape, with null supplier and null days of cover allowed", () => {
    const parsed = parseSuggestionsResponse(
      response([
        suggestion(),
        suggestion({
          productId: "product-2",
          supplierId: null,
          daysOfCover: null,
          leadTimeSource: "history",
          sampleCount: 4,
        }),
      ]),
    );
    expect(parsed.siteId).toBe("site-1");
    expect(parsed.suggestions).toHaveLength(2);
    expect(parsed.suggestions[1]).toMatchObject({
      supplierId: null,
      daysOfCover: null,
      leadTimeSource: "history",
      sampleCount: 4,
    });
  });

  it("accepts an empty suggestion list", () => {
    expect(parseSuggestionsResponse(response([])).suggestions).toEqual([]);
  });

  it("refuses a field renamed away from the contract", () => {
    const { dailyVelocity: _renamed, ...rest } = suggestion();
    expect(() => parseSuggestionsResponse(response([{ ...rest, daily_velocity: 2.5 }]))).toThrow(
      "Unexpected replenishment suggestions response.",
    );
  });

  it("refuses a lead time source the contract does not name", () => {
    expect(() => parseSuggestionsResponse(response([suggestion({ leadTimeSource: "guess" })]))).toThrow();
  });

  it("refuses a missing supplier key, since the contract always sends it (null when unknown)", () => {
    const { supplierId: _missing, ...rest } = suggestion();
    expect(() => parseSuggestionsResponse(response([rest]))).toThrow();
  });
});

describe("parseDraftOrdersResponse", () => {
  it("reads the created purchase orders", () => {
    const parsed = parseDraftOrdersResponse({ purchaseOrders: [{ id: "po-1", purchaseOrderNumber: "PO-0001" }] });
    expect(parsed.purchaseOrders).toEqual([{ id: "po-1", purchaseOrderNumber: "PO-0001" }]);
  });

  it("refuses an answer without the purchaseOrders list", () => {
    expect(() => parseDraftOrdersResponse({})).toThrow("Unexpected draft purchase orders response.");
  });
});
