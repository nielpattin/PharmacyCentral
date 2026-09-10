import { describe, expect, it } from "vitest";

import { allocateFefo } from "./fefo-allocate.ts";

describe("FEFO allocation", () => {
  it("orders released balances by expiry, batch, and location", () => {
    const result = allocateFefo(
      [
        {
          productBatchId: "late",
          storageLocationId: "b",
          expiryDate: "2027-01-01",
          batchNumber: "B",
          quantityOnHand: 10,
          quantityReserved: 0,
        },
        {
          productBatchId: "early",
          storageLocationId: "a",
          expiryDate: "2026-01-01",
          batchNumber: "A",
          quantityOnHand: 4,
          quantityReserved: 1,
        },
      ],
      5,
    );
    expect(result).toEqual([
      { productBatchId: "early", storageLocationId: "a", quantity: 3 },
      { productBatchId: "late", storageLocationId: "b", quantity: 2 },
    ]);
  });

  it("rejects requests larger than available stock", () => {
    expect(() => allocateFefo([], 1)).toThrow("Insufficient stock");
  });
});
