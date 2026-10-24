import { describe, expect, it } from "vitest";

import { nextTabIndex } from "./tabs-nav.ts";

describe("nextTabIndex", () => {
  it("wraps from the last tab to the first and back", () => {
    expect(nextTabIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 3)).toBe(2);
  });

  it("jumps to the ends with Home and End", () => {
    expect(nextTabIndex(1, "Home", 4)).toBe(0);
    expect(nextTabIndex(1, "End", 4)).toBe(3);
  });

  it("ignores other keys and an empty list", () => {
    expect(nextTabIndex(1, "Enter", 3)).toBeUndefined();
    expect(nextTabIndex(0, "ArrowRight", 0)).toBeUndefined();
  });
});
