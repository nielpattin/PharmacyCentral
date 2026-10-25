import { describe, expect, it } from "vitest";

import { dynamicMessageRules } from "../i18n.ts";

const render = (message: string): string | undefined => {
  for (const [pattern, translate] of dynamicMessageRules) {
    const match = pattern.exec(message);
    if (match) return translate(match);
  }
  return undefined;
};

describe("dynamic service messages", () => {
  it("names the batch and both quantities in a shortfall", () => {
    expect(render("Batch LOT-2603-052 has 0 available at this location, 10 needed")).toBe(
      "Lô LOT-2603-052 chỉ còn 0 tại vị trí này, cần 10",
    );
    expect(render("Batch B-1 has 2.5 available at this location, 3 needed")).toBe(
      "Lô B-1 chỉ còn 2.5 tại vị trí này, cần 3",
    );
  });

  it("covers an expired batch and one not yet released by quality control", () => {
    expect(render("Batch LOT-9 has expired")).toBe("Lô LOT-9 đã hết hạn");
    expect(render("Batch LOT-9 has not been released by quality control")).toBe(
      "Lô LOT-9 chưa được kiểm soát chất lượng duyệt",
    );
  });

  it("leaves an unknown text alone", () => {
    expect(render("Batch LOT-9 is on fire")).toBeUndefined();
  });
});
