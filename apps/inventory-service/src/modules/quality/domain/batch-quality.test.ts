import { describe, expect, it } from "vitest";

import { reviewBatchQuality } from "./batch-quality.ts";

describe("batch quality", () => {
  it("releases only a reviewable batch with positive stock", () => {
    expect(reviewBatchQuality("PendingQc", "release", true)).toBe("Released");
    expect(() => reviewBatchQuality("PendingQc", "release", false)).toThrow();
  });
});
