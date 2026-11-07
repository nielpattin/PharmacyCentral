import { describe, expect, it } from "vitest";

import {
  deadStockDraft,
  deadStockRef,
  expiringBatchDraft,
  expiryRef,
  fitText,
  replenishmentDraft,
  replenishmentRef,
  TITLE_MAX_LENGTH,
} from "./drafts.ts";

describe("source references", () => {
  it("builds the stable keys the contract names", () => {
    expect(replenishmentRef("site-1", "prod-2")).toBe("replenishment:site-1:prod-2");
    expect(expiryRef("site-1", "batch-3")).toBe("expiry:site-1:batch-3");
    expect(deadStockRef("site-1", "prod-2")).toBe("dead_stock:site-1:prod-2");
  });
});

describe("fitText", () => {
  it("keeps text that fits", () => {
    expect(fitText("Bổ sung", 10)).toBe("Bổ sung");
  });

  it("cuts text to the limit and ends it with an ellipsis", () => {
    const fitted = fitText("a".repeat(400), TITLE_MAX_LENGTH);
    expect(fitted.length).toBe(TITLE_MAX_LENGTH);
    expect(fitted.endsWith("…")).toBe(true);
  });
});

describe("replenishmentDraft", () => {
  it("names the product, the suggested quantity and the supplier", () => {
    expect(
      replenishmentDraft({
        siteId: "site-1",
        productId: "prod-2",
        productName: "Paracetamol 500mg",
        suggestedQuantity: 12,
        supplierName: "Công ty A",
      }),
    ).toEqual({
      sourceType: "replenishment",
      sourceRef: "replenishment:site-1:prod-2",
      title: "Bổ sung Paracetamol 500mg",
      detail: "Đề xuất đặt 12 đơn vị, nhà cung cấp: Công ty A.",
      siteId: "site-1",
      productId: "prod-2",
    });
  });

  it("says when no supplier is chosen yet", () => {
    const draft = replenishmentDraft({
      siteId: "site-1",
      productId: "prod-2",
      productName: "Gạc",
      suggestedQuantity: 3,
      supplierName: null,
    });
    expect(draft.detail).toBe("Đề xuất đặt 3 đơn vị, nhà cung cấp: chưa có nhà cung cấp.");
  });
});

describe("deadStockDraft", () => {
  it("states the quantity and the days without movement", () => {
    expect(
      deadStockDraft({
        siteId: "site-1",
        productId: "prod-2",
        productName: "Vitamin C",
        quantity: 40,
        deadStockDays: 90,
      }),
    ).toEqual({
      sourceType: "dead_stock",
      sourceRef: "dead_stock:site-1:prod-2",
      title: "Xử lý hàng tồn lâu: Vitamin C",
      detail: "Tồn 40 đơn vị, không có giao dịch trong 90 ngày.",
      siteId: "site-1",
      productId: "prod-2",
    });
  });

  it("does not invent a quantity the analytics answer could not count", () => {
    expect(
      deadStockDraft({ siteId: "s", productId: "p", productName: "X", quantity: null, deadStockDays: 90 }).detail,
    ).toBe("Tồn chưa rõ đơn vị, không có giao dịch trong 90 ngày.");
  });
});

describe("expiringBatchDraft", () => {
  const batch = {
    siteId: "site-1",
    batchId: "batch-3",
    productId: "prod-2",
    productName: "Amoxicillin",
    batchNumber: "LOT-7",
    expiryDate: "2026-11-10",
    quantityOnHand: 25,
    today: "2026-10-28",
  };

  it("calls a batch that expires within 30 days a batch about to expire", () => {
    expect(expiringBatchDraft(batch)).toEqual({
      sourceType: "expiry",
      sourceRef: "expiry:site-1:batch-3",
      title: "Lô sắp hết hạn: Amoxicillin",
      detail: "Lô LOT-7, hạn dùng 2026-11-10, tồn 25 đơn vị.",
      siteId: "site-1",
      productId: "prod-2",
    });
  });

  it("calls a batch past its expiry date an expired batch", () => {
    expect(expiringBatchDraft({ ...batch, expiryDate: "2026-10-01" }).title).toBe("Lô đã hết hạn: Amoxicillin");
  });
});
