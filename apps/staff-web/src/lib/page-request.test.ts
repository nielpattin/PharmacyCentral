import { describe, expect, it } from "vitest";

import { buildPagePath, parseNextCursor } from "./page-request.ts";

describe("parseNextCursor", () => {
  it("returns null when the header is absent or blank, which marks the last page", () => {
    expect(parseNextCursor(null)).toBeNull();
    expect(parseNextCursor(undefined)).toBeNull();
    expect(parseNextCursor("")).toBeNull();
    expect(parseNextCursor("   ")).toBeNull();
  });

  it("returns the trimmed opaque cursor", () => {
    expect(parseNextCursor(" eyJzIjoiMjAyNiJ9 ")).toBe("eyJzIjoiMjAyNiJ9");
    expect(parseNextCursor("abc_-XYZ09")).toBe("abc_-XYZ09");
  });

  it("throws on a value that is not base64url, instead of ending the list", () => {
    expect(() => parseNextCursor("not a cursor")).toThrow(/Malformed X-Next-Cursor/);
    expect(() => parseNextCursor("abc==")).toThrow(/Malformed X-Next-Cursor/);
  });
});

describe("buildPagePath", () => {
  it("skips empty and undefined params", () => {
    expect(buildPagePath("/api/orders", { limit: "100", q: "", status: undefined, cursor: undefined })).toBe(
      "/api/orders?limit=100",
    );
  });

  it("appends to an existing query string", () => {
    expect(buildPagePath("/api/orders?siteId=s1", { cursor: "abc" })).toBe("/api/orders?siteId=s1&cursor=abc");
  });

  it("returns the path unchanged when no param has a value", () => {
    expect(buildPagePath("/api/sites", { q: undefined })).toBe("/api/sites");
  });
});
