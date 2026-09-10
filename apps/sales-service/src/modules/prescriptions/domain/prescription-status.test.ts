import { describe, expect, it } from "vitest";

import { transitionPrescription } from "./prescription-status.ts";

describe("prescription status", () => {
  it("permits draft to pending and pending to dispensed", () => {
    expect(transitionPrescription("Draft", "Pending")).toBe("Pending");
    expect(transitionPrescription("Pending", "Dispensed")).toBe("Dispensed");
  });

  it("rejects dispensing a cancelled prescription", () => {
    expect(() => transitionPrescription("Cancelled", "Dispensed")).toThrow("Invalid prescription transition");
  });
});
