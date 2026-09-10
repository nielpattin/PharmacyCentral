import { describe, expect, it } from "vitest";

import { approveCount, calculateVariance } from "./stocktake.ts";

describe("stocktake invariants", () => {
  it("calculates and approves counted variances", () => {
    expect(calculateVariance({ systemQuantity: 10, countedQuantity: 8 })).toBe(-2);
    expect(approveCount({ systemQuantity: 10, countedQuantity: 8, status: "Counted" }).status).toBe("Approved");
  });
});
