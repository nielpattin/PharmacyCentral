import { describe, expect, it } from "vitest";

import { parseTablePreferences, serializeTablePreferences, type TablePreferences } from "./preferences.ts";

describe("parseTablePreferences", () => {
  it("round-trips a serialized preferences document", () => {
    const prefs: TablePreferences = { density: "compact", hiddenColumns: ["notes", "supplier"] };
    expect(parseTablePreferences(serializeTablePreferences(prefs))).toEqual(prefs);
  });

  it("returns null when nothing is stored", () => {
    expect(parseTablePreferences(null)).toBeNull();
  });

  it("ignores malformed JSON", () => {
    expect(parseTablePreferences("{not json")).toBeNull();
  });

  it("ignores non-object documents", () => {
    expect(parseTablePreferences("[]")).toBeNull();
    expect(parseTablePreferences("null")).toBeNull();
    expect(parseTablePreferences('"loose"')).toBeNull();
  });

  it("ignores documents with an unknown schema version", () => {
    expect(parseTablePreferences('{"density":"loose","hiddenColumns":[]}')).toBeNull();
    expect(parseTablePreferences('{"version":2,"density":"loose","hiddenColumns":[]}')).toBeNull();
  });

  it("ignores an unknown density", () => {
    expect(parseTablePreferences('{"version":1,"density":"huge","hiddenColumns":[]}')).toBeNull();
  });

  it("ignores hidden columns that are not an array of strings", () => {
    expect(parseTablePreferences('{"version":1,"density":"standard","hiddenColumns":"notes"}')).toBeNull();
    expect(parseTablePreferences('{"version":1,"density":"standard","hiddenColumns":["notes",3]}')).toBeNull();
  });

  it("drops duplicate hidden column keys", () => {
    expect(parseTablePreferences('{"version":1,"density":"loose","hiddenColumns":["a","a","b"]}')).toEqual({
      density: "loose",
      hiddenColumns: ["a", "b"],
    });
  });
});
