import { describe, expect, it } from "vitest";

import { headerSummary } from "./header-summary.ts";

describe("headerSummary", () => {
  it("joins the three parts with a middle dot", () => {
    expect(headerSummary({ current: "Current: A", previous: "Previous: B", updated: "Updated 10:00" })).toBe(
      "Current: A · Previous: B · Updated 10:00",
    );
  });

  it("leaves out the parts that are not known yet", () => {
    expect(headerSummary({ current: "Current: A", previous: "", updated: "" })).toBe("Current: A");
    expect(headerSummary({ current: "", previous: "", updated: "" })).toBe("");
  });
});
