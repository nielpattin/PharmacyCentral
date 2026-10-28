import { describe, expect, it } from "vitest";

import {
  LOW_STOCK_THRESHOLD,
  dailyVelocity,
  daysOfCover,
  isSuggested,
  leadTime,
  medianDays,
  minimumStock,
  replenishmentSuggestions,
  reorderPoint,
  suggestReplenishment,
  suggestedQuantity,
  targetStock,
  type ProductStockPosition,
  type ReplenishmentParams,
} from "./replenishment-suggestions.ts";

const params: ReplenishmentParams = { windowDays: 30, coverDays: 14, safetyDays: 7, defaultLeadTimeDays: 7 };
const supplier = "00000000-0000-4000-8000-0000000000aa";
const product = "00000000-0000-4000-8000-0000000000bb";

const position = (overrides: Partial<ProductStockPosition> = {}): ProductStockPosition => ({
  productId: product,
  onHand: 0,
  reserved: 0,
  dispensedQuantity: 0,
  inboundQuantity: 0,
  supplierId: supplier,
  ...overrides,
});

describe("replenishment formulas", () => {
  it("names the low-stock threshold of BR-REPORT-002 as 10 base units", () => {
    expect(LOW_STOCK_THRESHOLD).toBe(10);
  });

  it("computes the daily velocity over the window, fractions included", () => {
    expect(dailyVelocity(30, 30)).toBe(1);
    expect(dailyVelocity(10, 3)).toBeCloseTo(10 / 3, 12);
  });

  it("keeps the minimum stock at the threshold unless the safety stock is larger", () => {
    expect(minimumStock(1, 7)).toBe(10);
    expect(minimumStock(0, 0)).toBe(10);
    expect(minimumStock(5, 7)).toBe(35);
  });

  it("takes the median of the lead-time samples", () => {
    expect(medianDays([])).toBeUndefined();
    expect(medianDays([3])).toBe(3);
    expect(medianDays([5, 1, 2])).toBe(2);
    expect(medianDays([1, 2, 3, 10])).toBe(2.5);
  });

  it("uses the supplier's median rounded up to whole days, else the default marked as such", () => {
    expect(leadTime([], 7)).toEqual({ leadTimeDays: 7, leadTimeSource: "default", sampleCount: 0 });
    expect(leadTime([2.2, 3.1, 4], 7)).toEqual({ leadTimeDays: 4, leadTimeSource: "history", sampleCount: 3 });
    expect(leadTime([3, 3], 7)).toEqual({ leadTimeDays: 3, leadTimeSource: "history", sampleCount: 2 });
  });

  it("computes the reorder point and the target stock from velocity, lead time and cover", () => {
    expect(reorderPoint(2, 7, 14)).toBe(28);
    expect(targetStock(2, 7, 14, 14)).toBe(56);
  });

  it("rounds the suggested quantity up, at least one unit, and ignores float noise", () => {
    expect(suggestedQuantity(63.33333, 0, 0)).toBe(64);
    expect(suggestedQuantity(5, 10, 0)).toBe(1);
    // 0.1 * 3 is 0.30000000000000004 in floats; the 10 units needed are whole, so the noise must not add one.
    expect(suggestedQuantity(10.000000000000002, 0, 0)).toBe(10);
    expect(suggestedQuantity(30.000000000000004, 10, 10)).toBe(10);
  });

  it("answers the days of cover from available stock, and null when nothing sells", () => {
    expect(daysOfCover(20, 2)).toBe(10);
    expect(daysOfCover(20, 0)).toBeNull();
  });
});

describe("the suggest-when rule", () => {
  it("suggests a product that moved and sits at or below its reorder point", () => {
    // velocity 1, minimum 10, reorder point 17.
    expect(isSuggested({ onHand: 17, reserved: 0, dispensedQuantity: 30, inboundQuantity: 0 }, 17, 10)).toBe(true);
    expect(isSuggested({ onHand: 18, reserved: 0, dispensedQuantity: 30, inboundQuantity: 0 }, 17, 10)).toBe(false);
  });

  it("suggests a product with no velocity only when it is at or below the minimum stock", () => {
    expect(isSuggested({ onHand: 10, reserved: 0, dispensedQuantity: 0, inboundQuantity: 0 }, 10, 10)).toBe(true);
    expect(isSuggested({ onHand: 11, reserved: 0, dispensedQuantity: 0, inboundQuantity: 0 }, 10, 10)).toBe(false);
  });

  it("counts reserved stock out of the available quantity", () => {
    expect(isSuggested({ onHand: 30, reserved: 25, dispensedQuantity: 30, inboundQuantity: 0 }, 17, 10)).toBe(true);
  });
});

describe("suggestReplenishment", () => {
  it("suggests a product with no velocity that is below the minimum stock, for the gap to the target", () => {
    const suggestion = suggestReplenishment(position({ onHand: 4 }), leadTime([], 7), params);

    expect(suggestion).toEqual({
      productId: product,
      supplierId: supplier,
      dailyVelocity: 0,
      dispensedQuantity: 0,
      onHand: 4,
      reserved: 0,
      available: 4,
      inboundQuantity: 0,
      minimumStock: 10,
      leadTimeDays: 7,
      leadTimeSource: "default",
      sampleCount: 0,
      reorderPoint: 10,
      targetStock: 10,
      suggestedQuantity: 6,
      daysOfCover: null,
    });
  });

  it("does not suggest a product at its reorder point when its inbound quantity already reaches the target", () => {
    expect(suggestReplenishment(position({ onHand: 4, inboundQuantity: 6 }), leadTime([], 7), params)).toBeUndefined();
  });

  it("does not suggest a product with no velocity that is above the minimum stock", () => {
    expect(suggestReplenishment(position({ onHand: 25 }), leadTime([], 7), params)).toBeUndefined();
  });

  it("does not suggest a product whose inbound quantity already covers the need", () => {
    // velocity 2, safety 7 gives minimum 14; lead 7 gives reorder point 28.
    const selling = position({ onHand: 10, dispensedQuantity: 60 });
    const lead = leadTime([7], 7);

    expect(suggestReplenishment({ ...selling, inboundQuantity: 18 }, lead, params)).toMatchObject({
      reorderPoint: 28,
      targetStock: 56,
      suggestedQuantity: 28,
    });
    expect(suggestReplenishment({ ...selling, inboundQuantity: 19 }, lead, params)).toBeUndefined();
    expect(suggestReplenishment({ ...selling, inboundQuantity: 40 }, lead, params)).toBeUndefined();
  });

  it("rounds a fractional need up to whole base units", () => {
    // velocity 10/3, minimum 23.33, lead 4 gives reorder 36.67 and target 83.33; 20 available leaves 63.33 to order.
    const suggestion = suggestReplenishment(position({ onHand: 20, dispensedQuantity: 10 }), leadTime([4], 7), {
      ...params,
      windowDays: 3,
    });

    expect(suggestion?.dailyVelocity).toBeCloseTo(10 / 3, 12);
    expect(suggestion?.minimumStock).toBeCloseTo(70 / 3, 12);
    expect(suggestion?.reorderPoint).toBeCloseTo(110 / 3, 12);
    expect(suggestion?.targetStock).toBeCloseTo(250 / 3, 12);
    expect(suggestion?.suggestedQuantity).toBe(64);
  });

  it("uses the supplier's lead time when it has history", () => {
    const suggestion = suggestReplenishment(
      position({ onHand: 0, dispensedQuantity: 30 }),
      leadTime([2, 4], 7),
      params,
    );

    expect(suggestion).toMatchObject({ leadTimeDays: 3, leadTimeSource: "history", sampleCount: 2 });
  });
});

describe("replenishmentSuggestions", () => {
  it("groups lead-time samples by supplier and falls back to the default without history", () => {
    const otherSupplier = "00000000-0000-4000-8000-0000000000cc";
    const otherProduct = "00000000-0000-4000-8000-0000000000dd";
    const noSupplierProduct = "00000000-0000-4000-8000-0000000000ee";

    const suggestions = replenishmentSuggestions({
      positions: [
        position({ onHand: 0, dispensedQuantity: 30 }),
        position({ productId: otherProduct, supplierId: otherSupplier, onHand: 0, dispensedQuantity: 30 }),
        position({ productId: noSupplierProduct, supplierId: null, onHand: 0, dispensedQuantity: 30 }),
      ],
      leadTimeSamples: [
        { supplierId: supplier, days: 2 },
        { supplierId: supplier, days: 4 },
        { supplierId: otherSupplier, days: 9.5 },
      ],
      params,
    });

    expect(suggestions.map((row) => [row.productId, row.leadTimeDays, row.leadTimeSource, row.sampleCount])).toEqual([
      [product, 3, "history", 2],
      [otherProduct, 10, "history", 1],
      [noSupplierProduct, 7, "default", 0],
    ]);
  });

  it("returns only the products to reorder, in position order", () => {
    const suggestions = replenishmentSuggestions({
      positions: [
        position({ productId: "00000000-0000-4000-8000-000000000001", onHand: 500 }),
        position({ productId: "00000000-0000-4000-8000-000000000002", onHand: 3 }),
      ],
      leadTimeSamples: [],
      params,
    });

    expect(suggestions.map((row) => row.productId)).toEqual(["00000000-0000-4000-8000-000000000002"]);
  });

  it("returns nothing for a site with no positions", () => {
    expect(replenishmentSuggestions({ positions: [], leadTimeSamples: [], params })).toEqual([]);
  });
});
