import { describe, expect, it } from "vitest";

import { newUuid } from "./ids.ts";

describe("newUuid", () => {
  it("makes a version 4 UUID that the payment and sales services accept", () => {
    expect(newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("does not repeat", () => {
    expect(new Set(Array.from({ length: 200 }, newUuid)).size).toBe(200);
  });
});
