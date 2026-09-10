import { describe, expect, it } from "vitest";

import { transitionOrder } from "./order-status.ts";

describe("order status", () => {
  it("allows the fulfillment path and rejects repeated terminal transitions", () => {
    expect(transitionOrder("Pending", "Confirmed")).toBe("Confirmed");
    expect(transitionOrder("Ready", "Delivering")).toBe("Delivering");
    expect(() => transitionOrder("Completed", "Cancelled")).toThrow();
  });
});
