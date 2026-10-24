import { describe, expect, it } from "vitest";

import { labelOrShortId, shortId } from "./format.ts";

describe("label helpers", () => {
  it("shortens an id that has no loaded name", () => {
    expect(shortId("3f2a9c1b-0000-4000-8000-000000000000")).toBe("3f2a9c1b");
    expect(shortId("abc")).toBe("abc");
  });

  it("keeps a loaded label and falls back to a short id when the label is only the id", () => {
    expect(labelOrShortId("HN01 - Hanoi", "site-1234567890")).toBe("HN01 - Hanoi");
    expect(labelOrShortId("site-1234567890", "site-1234567890")).toBe("site-123");
  });
});
