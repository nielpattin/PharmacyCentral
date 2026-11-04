import { describe, expect, it } from "vitest";

import { feedShowsAction, operationsTiles, tileWarns } from "./operations-tiles.ts";

describe("operationsTiles", () => {
  it("puts the manager's approvals first and keeps prescriptions", () => {
    expect(operationsTiles("manager").map((tile) => tile.field)).toEqual([
      "pendingAdjustmentCount",
      "lowStockBatchCount",
      "expiringBatchCount",
      "openPrescriptionCount",
      "pendingTransferCount",
      "openStocktakeCount",
    ]);
  });

  it("gives warehouse staff the stock queues and no prescriptions", () => {
    const fields = operationsTiles("warehouse").map((tile) => tile.field);
    expect(fields).toEqual([
      "pendingTransferCount",
      "lowStockBatchCount",
      "openStocktakeCount",
      "pendingAdjustmentCount",
      "expiringBatchCount",
    ]);
    expect(fields).not.toContain("openPrescriptionCount");
  });
});

describe("tileWarns", () => {
  const [, low] = operationsTiles("manager");
  const [adjustments] = operationsTiles("manager");

  it("warns only for a positive answered count on a tile that can warn", () => {
    expect(tileWarns(low!, 24)).toBe(true);
    expect(tileWarns(low!, 0)).toBe(false);
    expect(tileWarns(adjustments!, 5)).toBe(false);
  });

  it("does not warn when the server did not answer", () => {
    expect(tileWarns(low!, undefined)).toBe(false);
    expect(tileWarns(low!, null)).toBe(false);
    expect(tileWarns(low!, Number.NaN)).toBe(false);
  });
});

describe("feedShowsAction", () => {
  it("shows a manager every action", () => {
    expect(feedShowsAction("manager", "sales.order.status-changed.v1")).toBe(true);
  });

  it("limits warehouse staff to inventory and procurement actions", () => {
    expect(feedShowsAction("warehouse", "inventory.transfer.approve")).toBe(true);
    expect(feedShowsAction("warehouse", "procurement.purchase-order.create")).toBe(true);
    expect(feedShowsAction("warehouse", "identity.session.login")).toBe(false);
    expect(feedShowsAction("warehouse", "sales.order.status-changed.v1")).toBe(false);
  });
});
