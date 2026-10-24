import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor, readCursorParam } from "./page-cursor.ts";

const position = { at: "2026-10-08T08:00:00.123456Z", id: "00000000-0000-4000-8000-00000000000a" };

describe("page cursor", () => {
  it("round trips a keyset position, keeping the microseconds", () => {
    const cursor = encodeCursor(position);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual(position);
  });

  it.each([
    ["an empty string", ""],
    ["characters outside base64url", "abc+/="],
    ["bytes that are not JSON", Buffer.from("not json").toString("base64url")],
    ["JSON without the position", Buffer.from(JSON.stringify({ at: position.at })).toString("base64url")],
    ["an extra field", Buffer.from(JSON.stringify({ ...position, offset: 40 })).toString("base64url")],
    [
      "a timestamp with milliseconds only",
      Buffer.from(JSON.stringify({ ...position, at: "2026-10-08T08:00:00.123Z" })).toString("base64url"),
    ],
    [
      "a date that is not on the calendar",
      Buffer.from(JSON.stringify({ ...position, at: "2026-02-30T08:00:00.123456Z" })).toString("base64url"),
    ],
    [
      "an hour past the day",
      Buffer.from(JSON.stringify({ ...position, at: "2026-10-08T24:00:00.000000Z" })).toString("base64url"),
    ],
    [
      "the year zero that Postgres refuses",
      Buffer.from(JSON.stringify({ ...position, at: "0000-01-01T00:00:00.000000Z" })).toString("base64url"),
    ],
    ["an id that is not a uuid", Buffer.from(JSON.stringify({ ...position, id: "rx-1" })).toString("base64url")],
  ])("refuses %s", (_label, cursor) => {
    expect(decodeCursor(cursor)).toBeUndefined();
  });

  it("reads an absent parameter as the first page and a repeated one as malformed", () => {
    expect(readCursorParam(undefined)).toEqual({ ok: true, cursor: undefined });
    expect(readCursorParam(encodeCursor(position))).toEqual({ ok: true, cursor: position });
    expect(readCursorParam(["a", "b"])).toEqual({ ok: false });
    expect(readCursorParam("")).toEqual({ ok: false });
  });
});
