import { describe, expect, it } from "vitest";

import { nextMenuIndex } from "./menu-nav.ts";

describe("nextMenuIndex", () => {
  it("moves down and up, wrapping around the ends", () => {
    expect(nextMenuIndex(0, "ArrowDown", [true, true, true])).toBe(1);
    expect(nextMenuIndex(2, "ArrowDown", [true, true, true])).toBe(0);
    expect(nextMenuIndex(0, "ArrowUp", [true, true, true])).toBe(2);
  });

  it("skips disabled items", () => {
    expect(nextMenuIndex(0, "ArrowDown", [true, false, true])).toBe(2);
    expect(nextMenuIndex(2, "ArrowUp", [true, false, true])).toBe(0);
    expect(nextMenuIndex(-1, "Home", [false, true, true])).toBe(1);
    expect(nextMenuIndex(0, "End", [true, true, false])).toBe(1);
  });

  it("starts from the first or last item when nothing is focused", () => {
    expect(nextMenuIndex(-1, "ArrowDown", [true, true])).toBe(0);
    expect(nextMenuIndex(-1, "ArrowUp", [true, true])).toBe(1);
  });

  it("ignores other keys and a menu with nothing enabled", () => {
    expect(nextMenuIndex(0, "a", [true, true])).toBeUndefined();
    expect(nextMenuIndex(0, "ArrowDown", [false, false])).toBeUndefined();
  });
});
