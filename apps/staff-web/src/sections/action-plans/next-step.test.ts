import { describe, expect, it } from "vitest";

import { ACTION_PLAN_SOURCE_TYPES } from "./contract.ts";
import { nextStepSection, PLAN_NEXT_STEPS } from "./next-step.ts";

describe("plan next step", () => {
  it("names a step and a page for every source of a plan", () => {
    for (const source of ACTION_PLAN_SOURCE_TYPES) {
      expect(PLAN_NEXT_STEPS[source].text.length).toBeGreaterThan(0);
    }
  });

  it("opens the page of the work for a role that may open it", () => {
    expect(nextStepSection("expiry", ["Pharmacist"])).toBe("inventory");
    expect(nextStepSection("replenishment", ["Pharmacist"])).toBe("replenishment");
    expect(nextStepSection("price_warning", ["Pharmacy Manager"])).toBe("pricing");
  });

  it("offers no page a role may not open, so a link never ends in a refusal", () => {
    expect(nextStepSection("price_warning", ["Pharmacist"])).toBeUndefined();
    expect(nextStepSection("price_warning", ["Warehouse Staff"])).toBeUndefined();
  });
});
