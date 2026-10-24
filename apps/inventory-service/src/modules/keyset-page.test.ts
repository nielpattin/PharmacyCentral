import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { sendPage, splitPage } from "./keyset-page.ts";
import { decodePageCursor } from "./page-cursor.ts";

const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  sortValue: `2026-03-01T10:00:00.00000${n}Z`,
});

describe("splitPage", () => {
  it("answers every item and no cursor when the request has no limit", () => {
    expect(splitPage([row(1), row(2), row(3)], undefined)).toEqual({
      items: [row(1), row(2), row(3)],
      nextCursor: undefined,
    });
  });

  it("answers no cursor when the rows fit in the page", () => {
    expect(splitPage([row(1)], 2).nextCursor).toBeUndefined();
    expect(splitPage([row(1), row(2)], 2).nextCursor).toBeUndefined();
  });

  it("keeps the page and points the cursor at its last item when another row follows", () => {
    const { items, nextCursor } = splitPage([row(1), row(2), row(3)], 2);

    expect(items).toEqual([row(1), row(2)]);
    expect(nextCursor).toBeDefined();
    expect(decodePageCursor(nextCursor ?? "", "timestamp")).toEqual({ sortValue: row(2).sortValue, id: row(2).id });
  });
});

describe("sendPage", () => {
  it("sets the next-page header only when a cursor is present", () => {
    const response = { set: vi.fn(), json: vi.fn() };

    sendPage(response as unknown as Response, { rows: [{ id: "a" }], nextCursor: "next" });
    sendPage(response as unknown as Response, { rows: [{ id: "b" }], nextCursor: undefined });

    expect(response.set.mock.calls).toEqual([["X-Next-Cursor", "next"]]);
    expect(response.json.mock.calls).toEqual([[[{ id: "a" }]], [[{ id: "b" }]]]);
  });
});
