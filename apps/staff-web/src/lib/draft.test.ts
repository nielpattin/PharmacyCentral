import { describe, expect, it } from "vitest";
import { z } from "zod";

import { draftStorageKey, parseDraft, pickDraftValues } from "./draft.ts";

const schema = z.object({ supplier: z.string(), notes: z.string(), quantity: z.string() });
const savedAt = "2026-10-24T03:00:00.000Z";

describe("pickDraftValues", () => {
  it("keeps plain text, numbers, booleans, and null", () => {
    expect(pickDraftValues({ supplier: "S1", quantity: 3, urgent: true, notes: null })).toEqual({
      supplier: "S1",
      quantity: 3,
      urgent: true,
      notes: null,
    });
  });

  it("drops files, objects, and explicitly excluded fields", () => {
    const file = new Blob(["x"]);
    const picked = pickDraftValues({ imageFile: file, lines: [{ id: 1 }], notes: "keep", reason: "drop" }, ["reason"]);
    expect(picked).toEqual({ notes: "keep" });
  });

  it("drops secret-looking field names even when not excluded", () => {
    expect(pickDraftValues({ newPassword: "x", confirmToken: "y", sku: "A1" })).toEqual({ sku: "A1" });
  });
});

describe("parseDraft", () => {
  it("accepts an envelope whose values match the form schema", () => {
    expect(parseDraft({ savedAt, values: { supplier: "S1", notes: "", quantity: "2" } }, schema)).toEqual({
      savedAt,
      values: { supplier: "S1", notes: "", quantity: "2" },
    });
  });

  it("rejects values that no longer match the schema", () => {
    expect(parseDraft({ savedAt, values: { supplier: "S1" } }, schema)).toBeUndefined();
  });

  it("rejects a malformed envelope or timestamp", () => {
    expect(parseDraft("draft", schema)).toBeUndefined();
    expect(parseDraft({ savedAt: "yesterday", values: {} }, schema)).toBeUndefined();
  });
});

describe("draftStorageKey", () => {
  it("is unique per user and form", () => {
    expect(draftStorageKey("u1", "purchase-order")).toBe("pharmacy-central:draft:u1:purchase-order");
    expect(draftStorageKey("u2", "purchase-order")).not.toBe(draftStorageKey("u1", "purchase-order"));
  });
});
