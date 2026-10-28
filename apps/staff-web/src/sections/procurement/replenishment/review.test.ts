import { describe, expect, it } from "vitest";

import type { Suggestion } from "./contract.ts";
import {
  groupBySupplier,
  isSelectable,
  parseOrderQuantity,
  planDraftOrders,
  quantityText,
  rowSupplierId,
  selectionCheckState,
  setProductsSelected,
} from "./review.ts";

const suggestion = (overrides: Partial<Suggestion>): Suggestion => ({
  productId: "product-1",
  supplierId: "supplier-1",
  dailyVelocity: 2,
  dispensedQuantity: 60,
  onHand: 10,
  reserved: 0,
  available: 10,
  inboundQuantity: 0,
  minimumStock: 10,
  leadTimeDays: 7,
  leadTimeSource: "history",
  sampleCount: 3,
  reorderPoint: 24,
  targetStock: 52,
  suggestedQuantity: 42,
  daysOfCover: 5,
  ...overrides,
});

const NO_CHOICES: ReadonlyMap<string, string> = new Map();
const NO_EDITS: ReadonlyMap<string, string> = new Map();
const SITE = "site-1";

describe("rowSupplierId", () => {
  it("uses the supplier the suggestion names over a picked one", () => {
    const choices = new Map([["product-1", "supplier-9"]]);
    expect(rowSupplierId(suggestion({ supplierId: "supplier-1" }), choices)).toBe("supplier-1");
  });

  it("uses the picked supplier when the suggestion names none", () => {
    const choices = new Map([["product-1", "supplier-9"]]);
    expect(rowSupplierId(suggestion({ supplierId: null }), choices)).toBe("supplier-9");
  });

  it("is null when neither names a supplier", () => {
    expect(rowSupplierId(suggestion({ supplierId: null }), NO_CHOICES)).toBeNull();
    expect(isSelectable(suggestion({ supplierId: null }), NO_CHOICES)).toBe(false);
    expect(isSelectable(suggestion({ supplierId: null }), new Map([["product-1", "supplier-2"]]))).toBe(true);
  });
});

describe("groupBySupplier", () => {
  it("groups rows by supplier in order of first appearance", () => {
    const rows = [
      suggestion({ productId: "a", supplierId: "s2" }),
      suggestion({ productId: "b", supplierId: "s1" }),
      suggestion({ productId: "c", supplierId: "s2" }),
    ];
    const groups = groupBySupplier(rows, NO_CHOICES);
    expect(groups.map((group) => group.supplierId)).toEqual(["s2", "s1"]);
    expect(groups[0]?.rows.map((row) => row.productId)).toEqual(["a", "c"]);
    expect(groups[1]?.rows.map((row) => row.productId)).toEqual(["b"]);
  });

  it("puts rows with no supplier yet in a last group, and moves them once a supplier is picked", () => {
    const rows = [suggestion({ productId: "a", supplierId: null }), suggestion({ productId: "b", supplierId: "s1" })];
    expect(groupBySupplier(rows, NO_CHOICES).map((group) => group.supplierId)).toEqual(["s1", null]);

    const picked = groupBySupplier(rows, new Map([["a", "s1"]]));
    expect(picked).toEqual([{ supplierId: "s1", rows: [rows[0], rows[1]] }]);
  });

  it("returns no groups for no rows", () => {
    expect(groupBySupplier([], NO_CHOICES)).toEqual([]);
  });
});

describe("setProductsSelected", () => {
  it("adds and removes ids without changing the set it was given", () => {
    const before = new Set(["a"]);
    const added = setProductsSelected(before, ["b", "c"], true);
    expect([...added].sort()).toEqual(["a", "b", "c"]);
    const removed = setProductsSelected(added, ["a", "c"], false);
    expect([...removed]).toEqual(["b"]);
    expect([...before]).toEqual(["a"]);
  });
});

describe("selectionCheckState", () => {
  it("reports none, some or all of the selectable ids", () => {
    const selected = new Set(["a", "b"]);
    expect(selectionCheckState(["c"], selected)).toBe("none");
    expect(selectionCheckState(["a", "c"], selected)).toBe("some");
    expect(selectionCheckState(["a", "b"], selected)).toBe("all");
  });

  it("is none for a group with nothing selectable", () => {
    expect(selectionCheckState([], new Set(["a"]))).toBe("none");
  });
});

describe("parseOrderQuantity", () => {
  it("accepts whole numbers of 1 or more, ignoring surrounding spaces", () => {
    expect(parseOrderQuantity("1")).toBe(1);
    expect(parseOrderQuantity(" 12 ")).toBe(12);
  });

  it("refuses zero, fractions, negatives, exponents, words and blanks", () => {
    for (const value of ["0", "2.5", "-3", "1e3", "abc", "", "  "]) {
      expect(parseOrderQuantity(value), value).toBeUndefined();
    }
  });
});

describe("quantityText", () => {
  it("shows the edited quantity, else the suggested one", () => {
    const row = suggestion({ productId: "a", suggestedQuantity: 42 });
    expect(quantityText(row, NO_EDITS)).toBe("42");
    expect(quantityText(row, new Map([["a", "50"]]))).toBe("50");
  });
});

describe("planDraftOrders", () => {
  it("creates one order per supplier with a line per selected row, in group order", () => {
    const rows = [
      suggestion({ productId: "a", supplierId: "s1", suggestedQuantity: 10 }),
      suggestion({ productId: "b", supplierId: "s2", suggestedQuantity: 20 }),
      suggestion({ productId: "c", supplierId: "s1", suggestedQuantity: 30 }),
    ];
    const plan = planDraftOrders(rows, new Set(["a", "b", "c"]), NO_CHOICES, NO_EDITS, SITE);
    expect(plan).toEqual({
      ok: true,
      orderCount: 2,
      lineCount: 3,
      body: {
        siteId: SITE,
        orders: [
          {
            supplierId: "s1",
            lines: [
              { productId: "a", orderedQuantity: 10 },
              { productId: "c", orderedQuantity: 30 },
            ],
          },
          { supplierId: "s2", lines: [{ productId: "b", orderedQuantity: 20 }] },
        ],
      },
    });
  });

  it("leaves out rows that are not selected", () => {
    const rows = [suggestion({ productId: "a" }), suggestion({ productId: "b" })];
    const plan = planDraftOrders(rows, new Set(["b"]), NO_CHOICES, NO_EDITS, SITE);
    expect(plan.ok && plan.body.orders).toEqual([
      { supplierId: "supplier-1", lines: [{ productId: "b", orderedQuantity: 42 }] },
    ]);
  });

  it("uses the edited quantity in place of the suggested one", () => {
    const rows = [suggestion({ productId: "a", suggestedQuantity: 42 })];
    const plan = planDraftOrders(rows, new Set(["a"]), NO_CHOICES, new Map([["a", "60"]]), SITE);
    expect(plan.ok && plan.body.orders[0]?.lines).toEqual([{ productId: "a", orderedQuantity: 60 }]);
  });

  it("never drafts a selected row that has no supplier", () => {
    const rows = [suggestion({ productId: "a", supplierId: null })];
    const plan = planDraftOrders(rows, new Set(["a"]), NO_CHOICES, NO_EDITS, SITE);
    expect(plan).toEqual({ ok: true, orderCount: 0, lineCount: 0, body: { siteId: SITE, orders: [] } });
  });

  it("drafts a row under the supplier the user picked", () => {
    const rows = [suggestion({ productId: "a", supplierId: null, suggestedQuantity: 5 })];
    const plan = planDraftOrders(rows, new Set(["a"]), new Map([["a", "s7"]]), NO_EDITS, SITE);
    expect(plan.ok && plan.body.orders).toEqual([
      { supplierId: "s7", lines: [{ productId: "a", orderedQuantity: 5 }] },
    ]);
  });

  it("refuses the whole plan, naming the rows, when a selected quantity is not valid", () => {
    const rows = [suggestion({ productId: "a" }), suggestion({ productId: "b" }), suggestion({ productId: "c" })];
    const plan = planDraftOrders(
      rows,
      new Set(["a", "b"]),
      NO_CHOICES,
      new Map([
        ["a", "0"],
        ["b", "x"],
      ]),
      SITE,
    );
    expect(plan).toEqual({ ok: false, invalidProductIds: ["a", "b"] });
  });

  it("is an empty plan when nothing is selected", () => {
    const rows = [suggestion({ productId: "a" })];
    expect(planDraftOrders(rows, new Set(), NO_CHOICES, NO_EDITS, SITE)).toEqual({
      ok: true,
      orderCount: 0,
      lineCount: 0,
      body: { siteId: SITE, orders: [] },
    });
  });
});
