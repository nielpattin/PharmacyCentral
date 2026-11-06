import { describe, expect, it } from "vitest";

import { refundAmount } from "./refund-request.ts";

describe("refundAmount", () => {
  it("leaves the amount out for the whole invoice or nothing typed", () => {
    expect(refundAmount("45000", "45000.00")).toBeUndefined();
    expect(refundAmount("  ", "45000")).toBeUndefined();
  });

  it("reads a smaller amount, with a decimal comma", () => {
    expect(refundAmount("12000", "45000")).toBe(12000);
    expect(refundAmount("12,5", "45000")).toBe(12.5);
  });

  it("passes text that is not a number on as NaN for the server to refuse", () => {
    expect(refundAmount("abc", "45000")).toBeNaN();
  });
});
