import { describe, expect, it } from "vitest";

import { applyMovement, availableQuantity, releaseQuantity, reserveQuantity } from "./stock-quantity.ts";

describe("inventory quantity rules", () => {
  it("keeps available quantity equal to on-hand minus reserved", () => {
    const quantity = { quantityOnHand: 10, quantityReserved: 3 };
    expect(availableQuantity(quantity)).toBe(7);
    expect(applyMovement(quantity, -2)).toEqual({ quantityOnHand: 8, quantityReserved: 3 });
  });

  it("rejects negative stock and movement below reservations", () => {
    expect(() => applyMovement({ quantityOnHand: 2, quantityReserved: 1 }, -2)).toThrow();
    expect(() => applyMovement({ quantityOnHand: 2, quantityReserved: 2 }, -1)).toThrow();
  });

  it("reserves and releases only available quantities", () => {
    const reserved = reserveQuantity({ quantityOnHand: 10, quantityReserved: 2 }, 5);
    expect(reserved.quantityReserved).toBe(7);
    expect(releaseQuantity(reserved, 3).quantityReserved).toBe(4);
    expect(() => reserveQuantity(reserved, 4)).toThrow();
  });
});
