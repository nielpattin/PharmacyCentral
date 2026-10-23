import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "./page-cursor.ts";

describe("page cursor", () => {
  it("gives back the offset it was made from", () => {
    expect(decodeCursor(encodeCursor(60))).toBe(60);
  });

  it.each([
    "",
    "not a cursor!",
    Buffer.from("0").toString("base64url"),
    Buffer.from("-5").toString("base64url"),
    Buffer.from("1.5").toString("base64url"),
    Buffer.from("12345678").toString("base64url"),
    Buffer.from("abc").toString("base64url"),
  ])("rejects %j", (cursor) => {
    expect(decodeCursor(cursor)).toBeUndefined();
  });
});
