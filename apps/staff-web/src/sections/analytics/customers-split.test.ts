import { describe, expect, it } from "vitest";

import { anonymousRevenue, partValue, splitTotal } from "./customers-split.ts";

describe("partValue", () => {
  it("keeps a positive figure", () => {
    expect(partValue(12)).toBe(12);
  });

  it("draws nothing for an unanswered, zero or negative figure", () => {
    expect(partValue(null)).toBe(0);
    expect(partValue(undefined)).toBe(0);
    expect(partValue(0)).toBe(0);
    expect(partValue(-3)).toBe(0);
  });
});

describe("anonymousRevenue", () => {
  it("works the walk-in revenue back from the identified share", () => {
    expect(anonymousRevenue(750_000, 0.75)).toBe(250_000);
  });

  it("is 0 when every sale had a customer account", () => {
    expect(anonymousRevenue(500_000, 1)).toBe(0);
  });

  it("is unanswered when the share or the revenue is", () => {
    expect(anonymousRevenue(null, 0.5)).toBeNull();
    expect(anonymousRevenue(500_000, null)).toBeNull();
    expect(anonymousRevenue(undefined, undefined)).toBeNull();
  });

  it("is unanswered when the share is 0, since the total cannot be known", () => {
    expect(anonymousRevenue(0, 0)).toBeNull();
  });
});

describe("splitTotal", () => {
  it("adds the parts", () => {
    expect(splitTotal([3, 4])).toBe(7);
    expect(splitTotal([0, 0])).toBe(0);
  });

  it("is unanswered when any part is", () => {
    expect(splitTotal([3, null])).toBeNull();
    expect(splitTotal([undefined, 4])).toBeNull();
  });
});
