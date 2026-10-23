import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { foldSearchText } from "./search-text.ts";

// The fixture is shared with the Go search service, which must fold every case the same way.
const foldCasesUrl = new URL("../../../../../search-service/testdata/fold-cases.json", import.meta.url);
const foldCases = z
  .array(z.object({ input: z.string(), folded: z.string() }))
  .parse(JSON.parse(readFileSync(foldCasesUrl, "utf8")));

describe("foldSearchText", () => {
  it("has fold cases to check", () => {
    expect(foldCases.length).toBeGreaterThan(0);
  });

  it.each(foldCases)("folds $input to $folded", ({ input, folded }) => {
    expect(foldSearchText(input)).toBe(folded);
  });
});
