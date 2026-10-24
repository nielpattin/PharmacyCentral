import { describe, expect, it } from "vitest";

import { applyListSearch, parseListSearch, serializeListValues } from "./list-url-state.ts";

const defaults = { q: "", status: "all", tab: "Lines" } as const;

describe("parseListSearch", () => {
  it("reads declared string params and falls back to defaults for anything else", () => {
    expect(parseListSearch({ q: "amoxicillin", status: 5, extra: "x" }, defaults)).toEqual({
      q: "amoxicillin",
      status: "all",
      tab: "Lines",
    });
  });

  it("treats an empty string as the default", () => {
    expect(parseListSearch({ q: "", status: "open" }, defaults).status).toBe("open");
    expect(parseListSearch({ q: "" }, defaults).q).toBe("");
  });

  it("ignores inherited object keys", () => {
    expect(parseListSearch({}, { constructor: "" }).constructor).toBe("");
  });
});

describe("serializeListValues", () => {
  it("keeps only values that differ from the default", () => {
    expect(serializeListValues({ q: "", status: "open", tab: "Lines" }, defaults)).toEqual({ status: "open" });
  });

  it("drops keys the page did not declare", () => {
    expect(serializeListValues({ q: "x", other: "y" }, defaults)).toEqual({ q: "x" });
  });
});

describe("applyListSearch", () => {
  it("keeps params the page does not declare and removes declared keys set to default", () => {
    const next = applyListSearch(
      { q: "x", tab: "Transfers", status: "all", page: "2" },
      { q: "x", status: "all", tab: "Transfers" },
      defaults,
    );
    expect(next).toEqual({ page: "2", q: "x", tab: "Transfers" });
  });

  it("round-trips through parse", () => {
    const values = { q: "para", status: "closed", tab: "Lines" };
    const search = applyListSearch({}, values, defaults);
    expect(parseListSearch(search, defaults)).toEqual(values);
  });
});
