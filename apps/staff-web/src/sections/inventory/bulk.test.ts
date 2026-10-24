import { describe, expect, it } from "vitest";

import { bulkMessage, fillTemplate, runEach, summarizeBulk } from "./bulk.ts";

const templates = {
  success: "{done} of {total} adjustments approved.",
  partial: "{done} of {total} adjustments approved.",
  failedPrefix: "Not completed:",
};

describe("summarizeBulk", () => {
  it("counts the items that did not fail as done", () => {
    const summary = summarizeBulk([
      { label: "a1", error: undefined },
      { label: "a2", error: "Adjustment is already Approved" },
      { label: "a3", error: undefined },
    ]);
    expect(summary).toEqual({
      total: 3,
      done: 2,
      failures: [{ label: "a2", error: "Adjustment is already Approved" }],
    });
  });

  it("handles an empty selection", () => {
    expect(summarizeBulk([])).toEqual({ total: 0, done: 0, failures: [] });
  });
});

describe("bulkMessage", () => {
  it("reports success with the counts and no failure list", () => {
    expect(bulkMessage(summarizeBulk([{ label: "a1", error: undefined }]), templates)).toEqual({
      tone: "success",
      text: "1 of 1 adjustments approved.",
    });
  });

  it("reports a partial failure as an error that names each failed item", () => {
    const message = bulkMessage(
      summarizeBulk([
        { label: "a1", error: undefined },
        { label: "a2", error: "Adjustment is already Approved" },
        { label: "a3", error: undefined },
        { label: "a4", error: "Not found" },
      ]),
      templates,
    );
    expect(message).toEqual({
      tone: "error",
      text: "2 of 4 adjustments approved. Not completed: a2: Adjustment is already Approved; a4: Not found",
    });
  });
});

describe("fillTemplate", () => {
  it("replaces known placeholders and keeps unknown ones", () => {
    expect(fillTemplate("{done} of {total} {noun}", { done: 3, total: 4 })).toBe("3 of 4 {noun}");
  });
});

describe("runEach", () => {
  it("sends every item even after one fails, and records each outcome in order", async () => {
    const sent: string[] = [];
    const outcomes = await runEach(
      ["x", "y", "z"],
      (item) => item.toUpperCase(),
      async (item) => {
        sent.push(item);
        if (item === "y") throw new Error("Conflict");
      },
    );
    expect(sent).toEqual(["x", "y", "z"]);
    expect(outcomes).toEqual([
      { label: "X", error: undefined },
      { label: "Y", error: "Conflict" },
      { label: "Z", error: undefined },
    ]);
  });

  it("uses a generic message for a thrown value that is not an Error", async () => {
    const outcomes = await runEach(
      ["x"],
      (item) => item,
      async () => {
        throw "boom";
      },
    );
    expect(outcomes).toEqual([{ label: "x", error: "The request failed." }]);
  });
});
