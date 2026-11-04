import { describe, expect, it } from "vitest";

import { abcParts, categoryBars, chartData, prescriptionParts, productBars, siteBars } from "./revenue-bars.ts";

const format = {
  money: (value: unknown) => (typeof value === "number" ? `${value}đ` : "—"),
  count: (value: unknown) => (typeof value === "number" ? String(value) : "—"),
  rate: (value: unknown) => (typeof value === "number" ? `${Math.round(value * 100)}%` : "—"),
};

describe("siteBars", () => {
  it("ranks by revenue, names an unknown site, and writes orders and average order value as the hint", () => {
    const bars = siteBars(
      [
        { siteId: "b", siteName: "Branch 2", revenue: 100, orderCount: 2, averageOrderValue: 50 },
        { siteId: null, siteName: null, revenue: 300, orderCount: 3, averageOrderValue: 100 },
      ],
      format,
      { unknownSite: "Unknown site", orders: "Orders" },
    );
    expect(bars.map((bar) => bar.label)).toEqual(["Unknown site", "Branch 2"]);
    expect(bars[0]).toMatchObject({ key: "unknown", value: 300, display: "300đ", hint: "3 Orders · 100đ" });
  });

  it("puts an unanswered revenue last with an empty bar and a dash, never zero", () => {
    const bars = siteBars(
      [
        { siteId: "a", siteName: "A", revenue: null, orderCount: null, averageOrderValue: null },
        { siteId: "b", siteName: "B", revenue: 10, orderCount: 1, averageOrderValue: 10 },
      ],
      format,
      { unknownSite: "?", orders: "Orders" },
    );
    expect(bars.map((bar) => bar.key)).toEqual(["b", "a"]);
    expect(bars[1]).toMatchObject({ value: 0, display: "—", hint: "— Orders · —" });
  });

  it("returns nothing for no rows", () => {
    expect(siteBars([], format, { unknownSite: "?", orders: "Orders" })).toEqual([]);
  });
});

describe("categoryBars", () => {
  it("labels a missing category and shows the share as the hint", () => {
    const bars = categoryBars(
      [
        { category: "Vitamins", revenue: 50, share: 0.25 },
        { category: null, revenue: 150, share: 0.75 },
      ],
      format,
      { uncategorized: "Uncategorized" },
    );
    expect(bars.map((bar) => [bar.label, bar.hint])).toEqual([
      ["Uncategorized", "75%"],
      ["Vitamins", "25%"],
    ]);
  });
});

describe("productBars", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    productId: `p${index}`,
    productName: `Product ${index}`,
    revenue: index * 10,
    share: null,
  }));

  it("keeps the top rows by revenue and leaves the rest to the table", () => {
    const bars = productBars(rows, format);
    expect(bars).toHaveLength(8);
    expect(bars[0]?.key).toBe("p11");
    expect(bars[7]?.key).toBe("p4");
  });

  it("shows a dash for an unanswered share", () => {
    expect(productBars(rows, format, 1)[0]?.hint).toBe("—");
  });
});

describe("abcParts", () => {
  it("orders A, B, C whatever the server sent and counts the products in the label", () => {
    const parts = abcParts(
      [
        { abcClass: "C", productCount: 30, revenue: 5, share: 0.05 },
        { abcClass: "A", productCount: 2, revenue: 80, share: 0.8 },
        { abcClass: "B", productCount: 8, revenue: 15, share: 0.15 },
      ],
      format,
      { classLabel: "Class", products: "Products" },
    );
    expect(parts.map((part) => part.key)).toEqual(["A", "B", "C"]);
    expect(parts[0]).toEqual({ key: "A", label: "Class A · Products: 2", value: 80, display: "80đ" });
  });

  it("does not invent a class the server left out", () => {
    const parts = abcParts([{ abcClass: "A", productCount: 1, revenue: 1, share: 1 }], format, {
      classLabel: "Class",
      products: "Products",
    });
    expect(parts.map((part) => part.key)).toEqual(["A"]);
  });

  it("gives an unanswered revenue a zero-size part that still reads as a dash", () => {
    const [part] = abcParts([{ abcClass: "A", productCount: null, revenue: null, share: null }], format, {
      classLabel: "Class",
      products: "Products",
    });
    expect(part).toMatchObject({ value: 0, display: "—", label: "Class A · Products: —" });
  });
});

describe("prescriptionParts", () => {
  const labels = { prescription: "Rx", otc: "OTC", unknown: "Unknown" };

  it("orders prescription, over the counter, unknown", () => {
    const parts = prescriptionParts(
      [
        { group: "unknown", revenue: 1, share: 0.01 },
        { group: "otc", revenue: 60, share: 0.6 },
        { group: "prescription", revenue: 39, share: 0.39 },
      ],
      format,
      labels,
    );
    expect(parts.map((part) => part.label)).toEqual(["Rx", "OTC", "Unknown"]);
    expect(parts[1]).toMatchObject({ value: 60, display: "60đ" });
  });

  it("returns an empty list for no rows", () => {
    expect(prescriptionParts([], format, labels)).toEqual([]);
  });
});

describe("chartData", () => {
  it("draws no bar for an unanswered revenue and writes a dash after its name", () => {
    const data = chartData(
      siteBars(
        [
          { siteId: "a", siteName: "A", revenue: null, orderCount: null, averageOrderValue: null },
          { siteId: "b", siteName: "B", revenue: 10, orderCount: 1, averageOrderValue: 10 },
        ],
        format,
        { unknownSite: "?", orders: "Orders" },
      ),
    );
    expect(data).toEqual([
      { key: "b", label: "B", values: [10] },
      { key: "a", label: "A · —", values: [null] },
    ]);
  });

  it("keeps a real zero revenue as a zero bar", () => {
    const [row] = chartData(
      categoryBars([{ category: "Vitamins", revenue: 0, share: 0 }], format, { uncategorized: "Uncategorized" }),
    );
    expect(row?.values).toEqual([0]);
  });
});
