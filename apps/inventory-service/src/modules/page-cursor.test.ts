import { describe, expect, it } from "vitest";

import {
  containsPattern,
  decodePageCursor,
  encodePageCursor,
  everything,
  readCommaList,
  readPageRequest,
  readSearchText,
  type PageOptions,
} from "./page-cursor.ts";

const id = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-03-01T10:00:00.123456Z";
const date = "2099-01-31";
const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const timestampOptions: PageOptions = { kind: "timestamp", defaultLimit: 100, maxLimit: 500 };

describe("page cursor", () => {
  it("gives back the position it was made from, for a timestamp and for a date", () => {
    expect(decodePageCursor(encodePageCursor({ sortValue: timestamp, id }), "timestamp")).toEqual({
      sortValue: timestamp,
      id,
    });
    expect(decodePageCursor(encodePageCursor({ sortValue: date, id }), "date")).toEqual({ sortValue: date, id });
  });

  it("refuses a cursor made for the other kind of sort value", () => {
    expect(decodePageCursor(encodePageCursor({ sortValue: date, id }), "timestamp")).toBeUndefined();
    expect(decodePageCursor(encodePageCursor({ sortValue: timestamp, id }), "date")).toBeUndefined();
  });

  it.each([
    ["an empty string", ""],
    ["text outside base64url", "not a cursor!"],
    ["text that is not JSON", Buffer.from("abc").toString("base64url")],
    ["a single value", encodeJson([timestamp])],
    ["a non-uuid id", encodeJson([timestamp, "not-an-id"])],
    ["an hour past 23", encodeJson(["2026-03-01T24:00:00.000000Z", id])],
    ["a timestamp without microseconds", encodeJson(["2026-03-01T10:00:00Z", id])],
    ["a cursor over the length limit", "a".repeat(600)],
  ])("refuses %s", (_name, cursor) => {
    expect(decodePageCursor(cursor, "timestamp")).toBeUndefined();
  });

  it("refuses a calendar date that does not exist", () => {
    expect(decodePageCursor(encodeJson(["2026-02-31", id]), "date")).toBeUndefined();
  });
});

describe("page request", () => {
  it("clamps the limit and takes the default for a limit that is not a number", () => {
    expect(readPageRequest({ limit: "0" }, timestampOptions)).toEqual({ limit: 1, cursor: undefined });
    expect(readPageRequest({ limit: "9999" }, timestampOptions)).toEqual({ limit: 500, cursor: undefined });
    expect(readPageRequest({ limit: "12.9" }, timestampOptions)).toEqual({ limit: 12, cursor: undefined });
    expect(readPageRequest({ limit: "abc" }, timestampOptions)).toEqual({ limit: 100, cursor: undefined });
    expect(readPageRequest({}, timestampOptions)).toEqual({ limit: 100, cursor: undefined });
  });

  it("answers the whole list when the list has no limit and the request sends neither limit nor cursor", () => {
    const unbounded: PageOptions = { ...timestampOptions, allWithoutLimit: true };

    expect(readPageRequest({}, unbounded)).toEqual(everything);
    expect(readPageRequest({ limit: "5" }, unbounded)).toEqual({ limit: 5, cursor: undefined });
  });

  it("pages with the default size when only a cursor is sent to an unbounded list", () => {
    const unbounded: PageOptions = { ...timestampOptions, allWithoutLimit: true };
    const cursor = encodePageCursor({ sortValue: timestamp, id });

    expect(readPageRequest({ cursor }, unbounded)).toEqual({
      limit: 100,
      cursor: { sortValue: timestamp, id },
    });
  });

  it("refuses a cursor that is repeated, empty, or not one of ours", () => {
    expect(readPageRequest({ cursor: ["a", "b"] }, timestampOptions)).toBeUndefined();
    expect(readPageRequest({ cursor: "" }, timestampOptions)).toBeUndefined();
    expect(readPageRequest({ cursor: "garbage" }, timestampOptions)).toBeUndefined();
  });
});

describe("search and filter text", () => {
  it("trims the free text and treats blank text as no search", () => {
    expect(readSearchText({ q: "  Pen  " })).toBe("Pen");
    expect(readSearchText({ q: "   " })).toBeUndefined();
    expect(readSearchText({})).toBeUndefined();
    expect(readSearchText({ q: ["a"] })).toBeUndefined();
  });

  it("reads comma-separated values, dropping blank items", () => {
    expect(readCommaList("Draft, Approved,,")).toEqual(["Draft", "Approved"]);
    expect(readCommaList(",")).toBeUndefined();
    expect(readCommaList(undefined)).toBeUndefined();
    expect(readCommaList(["Draft"])).toBeUndefined();
  });

  it("escapes the LIKE wildcards and the escape character so they match literally", () => {
    expect(containsPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});
