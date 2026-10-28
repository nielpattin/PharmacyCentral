import { describe, expect, it } from "vitest";

import {
  analyticsQuerySchema,
  averageOrderValue,
  buildDashboardAnalytics,
  daysOfInventoryOf,
  DEAD_STOCK_ITEM_LIMIT,
  inventoryHealthOf,
  isDeadStock,
  joinSales,
  lineValue,
  previousPeriodOf,
  stockoutRateOf,
  totalSales,
  turnoverOf,
  type AnalyticsInput,
  type BasePrice,
  type PaidInvoice,
  type SalesDocument,
  type SiteName,
  type StockHealthRow,
} from "./analytics.ts";

const DAY = 86_400_000;
const uuidOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const SITE_A = uuidOf(0xa1);
const SITE_B = uuidOf(0xb1);
const P1 = uuidOf(0xc1);
const P2 = uuidOf(0xc2);
const P3 = uuidOf(0xc3);
const NOW = new Date("2026-10-28T00:00:00.000Z");
const PERIOD = { from: new Date("2026-10-08T00:00:00.000Z"), to: new Date("2026-10-15T00:00:00.000Z") };

const PRICES: BasePrice[] = [
  { productId: P1, productName: "Paracetamol", unitPrice: 1000 },
  { productId: P2, productName: "Amoxicillin", unitPrice: 2500 },
  { productId: P3, productName: "Vitamin C", unitPrice: null },
];
const SITES: SiteName[] = [{ id: SITE_A, name: "Chi nhánh A" }];

const document = (
  n: number,
  kind: "order" | "prescription",
  siteId: string | null,
  createdAt: string,
): SalesDocument => ({ id: uuidOf(n), kind, siteId, createdAt });

const invoiceOf = (n: number, kind: "order" | "prescription", amount: number): PaidInvoice => ({
  orderId: kind === "order" ? uuidOf(n) : null,
  prescriptionId: kind === "prescription" ? uuidOf(n) : null,
  amount,
  createdAt: "2026-10-09T00:00:00.000Z",
});

const stock = (overrides: Partial<StockHealthRow> = {}): StockHealthRow => ({
  siteId: SITE_A,
  productId: P1,
  onHand: 0,
  reserved: 0,
  dispensed: 0,
  netChange: 0,
  lastMovementAt: daysAgo(5),
  expired: 0,
  expiring30: 0,
  expiring60: 0,
  expiring90: 0,
  ...overrides,
});

/**
 * The fixture of the KPI tests. Documents 1 to 5 are sales in the current period (6 is created exactly at `to`, so it is
 * outside it); 7 and 8 are sales of the previous period; 9 is an invoice with no sales document.
 */
const salesInput = (overrides: Partial<AnalyticsInput> = {}): AnalyticsInput => ({
  now: NOW,
  period: PERIOD,
  siteId: null,
  scope: undefined,
  channel: "all",
  documents: [
    document(1, "order", SITE_A, "2026-10-09T10:00:00.000Z"),
    document(2, "prescription", SITE_A, "2026-10-10T10:00:00.000Z"),
    document(3, "order", SITE_B, "2026-10-12T10:00:00.000Z"),
    document(4, "order", null, "2026-10-11T10:00:00.000Z"),
    document(5, "order", SITE_A, "2026-10-08T00:00:00.000Z"),
    document(6, "order", SITE_A, "2026-10-15T00:00:00.000Z"),
    document(7, "order", SITE_A, "2026-10-03T10:00:00.000Z"),
    document(8, "prescription", SITE_B, "2026-10-07T12:00:00.000Z"),
  ],
  invoices: [
    invoiceOf(1, "order", 100_000),
    invoiceOf(2, "prescription", 50_000),
    invoiceOf(3, "order", 200_000),
    invoiceOf(4, "order", 30_000),
    invoiceOf(5, "order", 10_000),
    invoiceOf(6, "order", 999_000),
    invoiceOf(7, "order", 80_000),
    invoiceOf(8, "prescription", 40_000),
    invoiceOf(9, "order", 70_000),
  ],
  stockRows: [],
  basePrices: PRICES,
  sites: SITES,
  ...overrides,
});

describe("previous period", () => {
  it("is the same length as the period, ending where the period starts", () => {
    expect(previousPeriodOf(PERIOD)).toStrictEqual({
      from: new Date("2026-10-01T00:00:00.000Z"),
      to: new Date("2026-10-08T00:00:00.000Z"),
    });
  });
});

describe("sale join", () => {
  it("counts a document as a sale only with a Paid invoice, and sums its paid invoices", () => {
    const sales = joinSales(
      [
        document(1, "order", SITE_A, "2026-10-09T10:00:00.000Z"),
        document(2, "order", SITE_A, "2026-10-09T11:00:00.000Z"),
        document(3, "prescription", SITE_B, "2026-10-10T10:00:00.000Z"),
      ],
      [invoiceOf(1, "order", 100_000), invoiceOf(1, "order", 20_000), invoiceOf(3, "prescription", 50_000)],
    );
    expect(sales.map((sale) => [sale.documentId, sale.channel, sale.revenue])).toStrictEqual([
      [uuidOf(1), "online", 120_000],
      [uuidOf(3), "counter", 50_000],
    ]);
  });

  it("matches an invoice only to a document of its own kind", () => {
    const sales = joinSales(
      [document(4, "order", SITE_A, "2026-10-09T10:00:00.000Z")],
      [invoiceOf(4, "prescription", 1)],
    );
    expect(sales).toStrictEqual([]);
  });

  it("leaves out a document whose invoice is refunded or pending, because the read carries Paid invoices alone", () => {
    expect(joinSales([document(5, "order", SITE_A, "2026-10-09T10:00:00.000Z")], [])).toStrictEqual([]);
  });
});

describe("sales KPIs", () => {
  it("buckets by document createdAt, with `from` inclusive and `to` exclusive", () => {
    const answer = buildDashboardAnalytics(salesInput());
    // Current: 1, 2, 3, 4 and the document created exactly at `from` (5). Document 6 is at `to`, so it is out.
    expect(answer.kpis.revenue).toStrictEqual({ current: 390_000, previous: 120_000 });
    expect(answer.kpis.orderCount).toStrictEqual({ current: 5, previous: 2 });
  });

  it("averages revenue per sale, and answers null for an average over no sale", () => {
    const answer = buildDashboardAnalytics(salesInput());
    expect(answer.kpis.averageOrderValue).toStrictEqual({ current: 78_000, previous: 60_000 });
    expect(averageOrderValue({ revenue: 0, orderCount: 0 })).toBeNull();
    expect(averageOrderValue({ revenue: 10, orderCount: 4 })).toBe(3);
  });

  it("filters the sales KPIs by channel and lists both channels beside them", () => {
    const counter = buildDashboardAnalytics(salesInput({ channel: "counter" }));
    expect(counter.kpis.revenue.current).toBe(50_000);
    expect(counter.kpis.orderCount.current).toBe(1);
    expect(counter.channels).toStrictEqual([
      { channel: "counter", revenue: 50_000, orderCount: 1 },
      { channel: "online", revenue: 340_000, orderCount: 4 },
    ]);

    const online = buildDashboardAnalytics(salesInput({ channel: "online" }));
    expect(online.kpis.revenue).toStrictEqual({ current: 340_000, previous: 80_000 });
    expect(online.channels).toStrictEqual(counter.channels);
  });

  it("applies the requested site to the sales, and a scope excludes sites outside it and sales with no site", () => {
    const siteA = buildDashboardAnalytics(salesInput({ siteId: SITE_A }));
    expect(siteA.siteId).toBe(SITE_A);
    expect(siteA.kpis.revenue).toStrictEqual({ current: 160_000, previous: 80_000 });

    const scoped = buildDashboardAnalytics(salesInput({ scope: [SITE_A] }));
    expect(scoped.kpis.revenue.current).toBe(160_000);
    expect(scoped.kpis.orderCount.current).toBe(3);

    const outside = buildDashboardAnalytics(salesInput({ scope: [SITE_A], siteId: SITE_B }));
    expect(outside.kpis.revenue.current).toBe(0);
  });

  it("answers a null average when the filter leaves no sale in the period", () => {
    const answer = buildDashboardAnalytics(salesInput({ siteId: SITE_B, channel: "counter" }));
    expect(answer.kpis.orderCount.current).toBe(0);
    expect(answer.kpis.averageOrderValue).toStrictEqual({ current: null, previous: 40_000 });
  });

  it("never answers gross profit, because no purchase cost is kept", () => {
    expect(buildDashboardAnalytics(salesInput()).kpis.grossProfit).toStrictEqual({
      current: null,
      previous: null,
      available: false,
      reason: "no_cost_data",
    });
  });

  it("reports the previous period beside the current one", () => {
    const answer = buildDashboardAnalytics(salesInput());
    expect(answer.period).toStrictEqual({ from: "2026-10-08T00:00:00.000Z", to: "2026-10-15T00:00:00.000Z" });
    expect(answer.previousPeriod).toStrictEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" });
    expect(answer.currency).toBe("VND");
  });

  it("counts sales from totalSales directly with the same bucketing", () => {
    const sales = joinSales(salesInput().documents, salesInput().invoices);
    expect(totalSales(sales, PERIOD, { siteId: null, scope: undefined }, "all")).toStrictEqual({
      revenue: 390_000,
      orderCount: 5,
    });
  });
});

describe("inventory: turnover and days of inventory", () => {
  it("is dispensed over average stock, where opening is closing minus the period's net change", () => {
    // Closing 100, opening 100 - 20 = 80, average 90; 30 dispensed.
    const rows = [stock({ onHand: 100, netChange: 20, dispensed: 30 })];
    expect(turnoverOf(rows)).toBeCloseTo(1 / 3);
    expect(daysOfInventoryOf(30, turnoverOf(rows))).toBeCloseTo(90);
  });

  it("answers null when the average stock is 0", () => {
    expect(turnoverOf([stock({})])).toBeNull();
    expect(daysOfInventoryOf(30, null)).toBeNull();
  });

  it("answers null days of inventory when nothing was dispensed, since stock never turns", () => {
    const rows = [stock({ onHand: 10 })];
    expect(turnoverOf(rows)).toBe(0);
    expect(daysOfInventoryOf(7, 0)).toBeNull();
  });
});

describe("inventory: stockout rate", () => {
  it("is the share of (site, product) pairs whose available quantity is 0 or less now", () => {
    const rows = [
      stock({ onHand: 5, reserved: 5 }),
      stock({ onHand: 10, reserved: 0, productId: P2 }),
      stock({ onHand: 0, reserved: 0, productId: P3 }),
    ];
    expect(stockoutRateOf(rows)).toBeCloseTo(2 / 3);
  });

  it("answers null with no pair at all", () => {
    expect(stockoutRateOf([])).toBeNull();
  });

  it("counts the pairs and the out-of-stock pairs in the inventory health", () => {
    const health = inventoryHealthOf([stock({ onHand: 5, reserved: 5 }), stock({ onHand: 10, productId: P2 })], {
      now: NOW,
      periodDays: 7,
      prices: PRICES,
      sites: SITES,
    });
    expect(health.stockedProductCount).toBe(2);
    expect(health.outOfStockProductCount).toBe(1);
  });
});

describe("inventory: dead stock threshold", () => {
  it("is on-hand stock whose last movement is older than 90 days, or that never moved", () => {
    expect(isDeadStock(stock({ onHand: 10, lastMovementAt: daysAgo(91) }), NOW)).toBe(true);
    expect(isDeadStock(stock({ onHand: 10, lastMovementAt: null }), NOW)).toBe(true);
    // Exactly 90 days is not older than 90 days.
    expect(isDeadStock(stock({ onHand: 10, lastMovementAt: daysAgo(90) }), NOW)).toBe(false);
    expect(isDeadStock(stock({ onHand: 10, lastMovementAt: daysAgo(89) }), NOW)).toBe(false);
    // Nothing on hand has nothing to be dead.
    expect(isDeadStock(stock({ onHand: 0, lastMovementAt: daysAgo(400) }), NOW)).toBe(false);
  });

  it("values dead stock at today's price, orders items by value then quantity, and leaves a line with no price last", () => {
    const health = inventoryHealthOf(
      [
        stock({ onHand: 10, productId: P1, lastMovementAt: daysAgo(200) }),
        stock({ onHand: 4, productId: P2, lastMovementAt: daysAgo(200) }),
        stock({ onHand: 50, productId: P3, lastMovementAt: null }),
        stock({ onHand: 9, productId: P1, lastMovementAt: daysAgo(3) }),
      ],
      { now: NOW, periodDays: 7, prices: PRICES, sites: SITES },
    );
    expect(health.deadStock.deadStockDays).toBe(90);
    expect(health.deadStock.productCount).toBe(3);
    expect(health.deadStock.quantity).toBe(64);
    expect(health.deadStock.value).toBe(20_000);
    expect(health.deadStock.items.map((item) => item.productId)).toStrictEqual([P1, P2, P3]);
    expect(health.deadStock.items[2]?.value).toBeNull();
  });

  it("lists at most the top 20 items by value", () => {
    const prices: BasePrice[] = Array.from({ length: 22 }, (_, index) => ({
      productId: uuidOf(0x200 + index),
      productName: `Product ${index}`,
      unitPrice: 100 * (index + 1),
    }));
    const rows = prices.map((price) => stock({ productId: price.productId, onHand: 1, lastMovementAt: null }));
    const health = inventoryHealthOf(rows, { now: NOW, periodDays: 7, prices, sites: SITES });
    expect(health.deadStock.items).toHaveLength(DEAD_STOCK_ITEM_LIMIT);
    expect(health.deadStock.items[0]?.value).toBe(2200);
    expect(health.deadStock.items.at(-1)?.value).toBe(300);
    expect(health.deadStock.value).toBe(25_300);
  });
});

describe("inventory: expiry buckets", () => {
  it("values each bucket at today's base-unit price and adds nothing for a product with no price", () => {
    const health = inventoryHealthOf(
      [
        stock({ onHand: 10, productId: P1, expired: 4, expiring30: 2, expiring90: 1 }),
        stock({ onHand: 10, productId: P2, expiring30: 3, expiring60: 5 }),
        stock({ onHand: 10, productId: P3, expired: 1, expiring30: 7 }),
      ],
      { now: NOW, periodDays: 7, prices: PRICES, sites: SITES },
    );
    expect(health.expiry.expired).toStrictEqual({ productCount: 2, quantity: 5, value: 4_000 });
    expect(health.expiry.within30).toStrictEqual({ productCount: 3, quantity: 12, value: 9_500 });
    expect(health.expiry.within60).toStrictEqual({ productCount: 1, quantity: 5, value: 12_500 });
    expect(health.expiry.within90).toStrictEqual({ productCount: 1, quantity: 1, value: 1_000 });
  });
});

describe("inventory: stock value and missing prices", () => {
  it("values stock on hand at today's price by site, and counts each stocked line with no price", () => {
    const health = inventoryHealthOf(
      [
        stock({ onHand: 3, productId: P1, siteId: SITE_A }),
        stock({ onHand: 5, productId: P3, siteId: SITE_A }),
        stock({ onHand: 2, productId: P3, siteId: SITE_B }),
        stock({ onHand: 0, productId: P2, siteId: SITE_A }),
      ],
      { now: NOW, periodDays: 7, prices: PRICES, sites: SITES },
    );
    expect(health.stockValue.total).toBe(3_000);
    expect(health.stockValue.missingPriceCount).toBe(2);
    // A site with no name in the catalog is named by its id.
    expect(health.stockValue.bySite).toHaveLength(2);
    expect(health.stockValue.bySite).toEqual(
      expect.arrayContaining([
        { siteId: SITE_A, siteName: "Chi nhánh A", quantity: 8, value: 3_000 },
        { siteId: SITE_B, siteName: SITE_B, quantity: 2, value: 0 },
      ]),
    );
  });

  it("answers a line with no price as null, and a priced line as a whole-dong value", () => {
    expect(lineValue(3, null)).toBeNull();
    expect(lineValue(3, 1000.4)).toBe(3001);
  });
});

describe("analytics query", () => {
  const query = (overrides: Record<string, unknown> = {}) =>
    analyticsQuerySchema.safeParse({
      from: "2026-10-08T00:00:00.000Z",
      to: "2026-10-15T00:00:00.000Z",
      ...overrides,
    });

  it("accepts a period, an optional site and a channel", () => {
    expect(query({ siteId: SITE_A, channel: "online" }).success).toBe(true);
    const parsed = query();
    expect(parsed.success && parsed.data).toStrictEqual({
      from: "2026-10-08T00:00:00.000Z",
      to: "2026-10-15T00:00:00.000Z",
    });
  });

  it("refuses a period whose end is not after its start", () => {
    expect(query({ from: "2026-10-15T00:00:00.000Z", to: "2026-10-15T00:00:00.000Z" }).success).toBe(false);
    expect(query({ from: "2026-10-16T00:00:00.000Z" }).success).toBe(false);
  });

  it("allows 366 days and refuses a longer period", () => {
    expect(query({ from: "2025-10-14T00:00:00.000Z", to: "2026-10-15T00:00:00.000Z" }).success).toBe(true);
    expect(query({ from: "2025-10-13T00:00:00.000Z", to: "2026-10-15T00:00:00.000Z" }).success).toBe(false);
  });

  it("refuses a site id that is not a UUID, a channel outside the three, and a period without an offset", () => {
    expect(query({ siteId: "not-a-uuid" }).success).toBe(false);
    expect(query({ channel: "web" }).success).toBe(false);
    expect(query({ from: "2026-10-08", to: "2026-10-15" }).success).toBe(false);
  });
});
