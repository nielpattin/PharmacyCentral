import { describe, expect, it } from "vitest";
import { z } from "zod";

import { decodePageCursor, encodePageCursor, takeKeysetPage } from "./page-cursor.ts";

const id = "00000000-0000-4000-8000-000000000001";
const date = z.iso.date();
const code = z.string().min(1).max(50);
const encodeRaw = (text: string): string => Buffer.from(text).toString("base64url");

describe("keyset page cursor", () => {
  it("gives back the position it was made from, for a sort value the caller accepts", () => {
    expect(decodePageCursor(encodePageCursor({ sortValue: "2026-03-01", id }), date)).toEqual({
      sortValue: "2026-03-01",
      id,
    });
    expect(decodePageCursor(encodePageCursor({ sortValue: "SITE-001", id }), code)).toEqual({
      sortValue: "SITE-001",
      id,
    });
  });

  it("is URL safe, so it can travel in a query string unescaped", () => {
    expect(encodePageCursor({ sortValue: "SITE-001?&= ", id })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuses a well-formed position whose sort value the caller does not accept", () => {
    expect(decodePageCursor(encodePageCursor({ sortValue: "SITE-001", id }), date)).toBeUndefined();
  });

  it.each([
    ["an empty cursor", ""],
    ["characters outside base64url", "not a cursor!"],
    ["base64 of text that is not JSON", encodeRaw("not json")],
    ["base64 of a JSON object", encodeRaw(JSON.stringify({ sortValue: "2026-03-01", id }))],
    ["a tuple missing its id", encodeRaw(JSON.stringify(["2026-03-01"]))],
    ["a tuple with an extra member", encodeRaw(JSON.stringify(["2026-03-01", id, "extra"]))],
    ["a month that does not exist", encodeRaw(JSON.stringify(["2026-13-01", id]))],
    ["an id that is not a uuid", encodeRaw(JSON.stringify(["2026-03-01", "not-a-uuid"]))],
    ["a sort value of the wrong type", encodeRaw(JSON.stringify([20260301, id]))],
    ["a cursor longer than any position", "a".repeat(600)],
  ])("rejects %s", (_label, cursor) => {
    expect(decodePageCursor(cursor, date)).toBeUndefined();
  });
});

describe("takeKeysetPage", () => {
  it("keeps the first limit rows and reports that another page follows", () => {
    expect(takeKeysetPage([1, 2, 3], 2)).toEqual({ rows: [1, 2], hasMore: true });
  });

  it("reports no further page when the rows fit the limit exactly", () => {
    expect(takeKeysetPage([1, 2], 2)).toEqual({ rows: [1, 2], hasMore: false });
  });

  it("answers an empty page with no further page", () => {
    expect(takeKeysetPage([], 2)).toEqual({ rows: [], hasMore: false });
  });
});
