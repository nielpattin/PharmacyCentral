import { describe, expect, it } from "vitest";

import { transitionReplenishment } from "./replenishment-request.ts";

describe("replenishment lifecycle", () => {
  it("supports pharmacist request, warehouse review, and fulfillment", () => {
    expect(transitionReplenishment("Pending", "approve")).toBe("Approved");
    expect(transitionReplenishment("Approved", "fulfill")).toBe("Fulfilled");
    expect(() => transitionReplenishment("Fulfilled", "cancel")).toThrow();
  });
});
