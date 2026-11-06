import { describe, expect, it } from "vitest";

import { readAllPages, type PagedResult } from "./read-all-pages.ts";

const result = (pages: string[], hasNextPage: boolean): PagedResult<string> => ({
  data: { pages },
  hasNextPage,
  isError: false,
  error: null,
});

describe("readAllPages", () => {
  it("returns the pages already read when no page follows, without fetching", async () => {
    let fetches = 0;
    const pages = await readAllPages({ data: { pages: ["a"] }, hasNextPage: false }, async () => {
      fetches += 1;
      return result([], false);
    });
    expect(pages).toEqual(["a"]);
    expect(fetches).toBe(0);
  });

  it("keeps fetching until the last page, then returns every page in order", async () => {
    const steps = [result(["a", "b"], true), result(["a", "b", "c"], false)];
    const pages = await readAllPages({ data: { pages: ["a"] }, hasNextPage: true }, async () => steps.shift()!);
    expect(pages).toEqual(["a", "b", "c"]);
  });

  it("rejects when a page fails, instead of returning half a list", async () => {
    await expect(
      readAllPages({ data: { pages: ["a"] }, hasNextPage: true }, async () => ({
        data: { pages: ["a"] },
        hasNextPage: true,
        isError: true,
        error: new Error("boom"),
      })),
    ).rejects.toThrow("boom");
  });

  it("answers an empty list when nothing was read", async () => {
    expect(await readAllPages({ data: undefined, hasNextPage: false }, async () => result([], false))).toEqual([]);
  });
});
