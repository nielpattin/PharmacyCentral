import { describe, expect, it } from "vitest";

import { selectionState, setVisibleSelection, toggleSelectionKey } from "./selection.ts";

describe("selectionState", () => {
  it("is none when no visible row is selected, including an empty page", () => {
    expect(selectionState([], new Set(["a"]))).toBe("none");
    expect(selectionState(["a", "b"], new Set(["z"]))).toBe("none");
  });

  it("is some when only part of the visible rows is selected", () => {
    expect(selectionState(["a", "b"], new Set(["a"]))).toBe("some");
  });

  it("is all when every visible row is selected, even with extra keys outside the page", () => {
    expect(selectionState(["a", "b"], new Set(["a", "b", "z"]))).toBe("all");
  });
});

describe("toggleSelectionKey", () => {
  it("adds a missing key and removes a present one without mutating the input", () => {
    const original = new Set(["a"]);
    const added = toggleSelectionKey(original, "b");
    expect([...added]).toEqual(["a", "b"]);
    const removed = toggleSelectionKey(original, "a");
    expect([...removed]).toEqual([]);
    expect([...original]).toEqual(["a"]);
  });
});

describe("setVisibleSelection", () => {
  it("selects the visible rows and keeps selections outside them", () => {
    const next = setVisibleSelection(new Set(["z"]), ["a", "b"], true);
    expect([...next].sort()).toEqual(["a", "b", "z"]);
  });

  it("clears only the visible rows", () => {
    const next = setVisibleSelection(new Set(["a", "b", "z"]), ["a", "b"], false);
    expect([...next]).toEqual(["z"]);
  });
});
