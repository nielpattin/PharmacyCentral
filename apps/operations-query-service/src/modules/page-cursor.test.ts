import { describe, expect, it } from "vitest";

import { decodePageCursor, encodePageCursor } from "./page-cursor.ts";

const position = { sortAt: "2026-10-24T10:00:00.123456Z", id: "00000000-0000-4000-8000-0000000000aa" };

describe("page cursor", () => {
  it("gives back the position it was made from, microseconds included", () => {
    expect(decodePageCursor(encodePageCursor(position))).toStrictEqual(position);
  });

  it("is opaque base64url text", () => {
    expect(encodePageCursor(position)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    "",
    "not a cursor!",
    Buffer.from("0").toString("base64url"),
    Buffer.from(JSON.stringify(["2026-10-24T10:00:00Z"])).toString("base64url"),
    Buffer.from(JSON.stringify([position.sortAt, "not-a-uuid"])).toString("base64url"),
    Buffer.from(JSON.stringify(["2026-10-24 10:00:00+00", position.id])).toString("base64url"),
    Buffer.from(JSON.stringify(["2026-02-31T10:00:00Z", position.id])).toString("base64url"),
    Buffer.from(JSON.stringify([42, position.id])).toString("base64url"),
    Buffer.from("[not json").toString("base64url"),
    "A".repeat(600),
  ])("rejects %j", (cursor) => {
    expect(decodePageCursor(cursor)).toBeUndefined();
  });
});
