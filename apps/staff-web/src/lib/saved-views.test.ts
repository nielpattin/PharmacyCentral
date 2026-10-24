import { describe, expect, it } from "vitest";

import {
  MAX_SAVED_VIEWS,
  addSavedView,
  parseSavedViews,
  removeSavedView,
  renameSavedView,
  savedViewsStorageKey,
  type SavedView,
} from "./saved-views.ts";

const view = (id: string, name = `View ${id}`): SavedView => ({ id, name, params: { status: "open" } });

describe("parseSavedViews", () => {
  it("returns nothing for values that are not an array", () => {
    expect(parseSavedViews(undefined)).toEqual([]);
    expect(parseSavedViews({ id: "a" })).toEqual([]);
  });

  it("drops malformed entries and keeps the valid ones", () => {
    const parsed = parseSavedViews([
      view("a"),
      { id: "b", name: "", params: {} },
      { id: "c", name: "Ok", params: { status: 3 } },
      "garbage",
      view("d"),
    ]);
    expect(parsed.map((item) => item.id)).toEqual(["a", "d"]);
  });

  it("keeps the first entry of a duplicated id", () => {
    expect(parseSavedViews([view("a", "First"), view("a", "Second")]).map((item) => item.name)).toEqual(["First"]);
  });

  it("caps the list at the maximum", () => {
    const many = Array.from({ length: MAX_SAVED_VIEWS + 5 }, (_, index) => view(`v${index}`));
    expect(parseSavedViews(many)).toHaveLength(MAX_SAVED_VIEWS);
  });

  it("trims stored names", () => {
    expect(parseSavedViews([{ id: "a", name: "  Expiring  ", params: {} }])[0]?.name).toBe("Expiring");
  });
});

describe("saved view mutations", () => {
  it("adds a valid view and refuses past the limit", () => {
    const full = Array.from({ length: MAX_SAVED_VIEWS }, (_, index) => view(`v${index}`));
    expect(addSavedView([], view("a"))).toEqual([view("a")]);
    expect(addSavedView(full, view("extra"))).toBeUndefined();
  });

  it("refuses an invalid view", () => {
    expect(addSavedView([], { id: "", name: "x", params: {} })).toBeUndefined();
  });

  it("renames with a trimmed name and refuses an empty one", () => {
    expect(renameSavedView([view("a")], "a", "  Weekly  ")?.[0]?.name).toBe("Weekly");
    expect(renameSavedView([view("a")], "a", "   ")).toBeUndefined();
  });

  it("removes by id", () => {
    expect(removeSavedView([view("a"), view("b")], "a")).toEqual([view("b")]);
  });
});

describe("savedViewsStorageKey", () => {
  it("scopes each page to one user", () => {
    expect(savedViewsStorageKey("u1", "orders")).not.toBe(savedViewsStorageKey("u2", "orders"));
    expect(savedViewsStorageKey("u1", "orders")).not.toBe(savedViewsStorageKey("u1", "receiving"));
  });
});
