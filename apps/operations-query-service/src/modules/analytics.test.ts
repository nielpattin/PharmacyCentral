import { describe, expect, it } from "vitest";

import {
  ABC_A_CUMULATIVE_SHARE,
  ABC_B_CUMULATIVE_SHARE,
  abcOf,
  ANALYTICS_SECTIONS,
  analyticsQuerySchema,
  averageOrderValue,
  buildAnalyticsSection,
  buildSalesTargetsReport,
  customerInsightsOf,
  dailySalesOf,
  daysOfInventoryOf,
  DEAD_STOCK_ITEM_LIMIT,
  grossProfitOf,
  indexDispenseCosts,
  indexSaleLines,
  inventoryHealthOf,
  isDeadStock,
  joinSales,
  lineValue,
  previousPeriodOf,
  salesBreakdownOf,
  salesTargetQuerySchema,
  stockoutRateOf,
  totalSales,
  turnoverOf,
  type AnalyticsChannel,
  type BasePrice,
  type CustomerFirstPaid,
  type CustomersAnalytics,
  type DispenseCost,
  type InventoryAnalytics,
  type OverviewAnalytics,
  type PaidInvoice,
  type Period,
  type ProductClassification,
  type RevenueAnalytics,
  type Sale,
  type SaleLine,
  type SalesDocument,
  type SiteName,
  type StockHealthRow,
} from "./analytics.ts";

/**
 * One field per read a tab can ask for, so a test composes the fixture it needs and the builders below hand each tab
 * exactly its own fields. Building one tab never looks at the reads of another, which the per-section tests assert.
 */
type AnalyticsFixture = {
  now: Date;
  period: Period;
  siteId: string | null;
  scope: readonly string[] | undefined;
  channel: AnalyticsChannel;
  documents: SalesDocument[];
  invoices: PaidInvoice[];
  customerFirstPaid: CustomerFirstPaid[];
  dispenseCosts: DispenseCost[];
  stockRows: StockHealthRow[];
  basePrices: BasePrice[];
  sites: SiteName[];
  products: ProductClassification[];
};

/** The fields every tab's input carries; each builder below adds the reads of the tab it answers. */
const commonInput = (input: AnalyticsFixture) => ({
  now: input.now,
  period: input.period,
  siteId: input.siteId,
  scope: input.scope,
  channel: input.channel,
});

const overviewAnswer = (input: AnalyticsFixture): OverviewAnalytics =>
  buildAnalyticsSection({
    section: "overview",
    ...commonInput(input),
    documents: input.documents,
    invoices: input.invoices,
    dispenseCosts: input.dispenseCosts,
  });

const revenueAnswer = (input: AnalyticsFixture): RevenueAnalytics =>
  buildAnalyticsSection({
    section: "revenue",
    ...commonInput(input),
    documents: input.documents,
    invoices: input.invoices,
    products: input.products,
    sites: input.sites,
  });

const customersAnswer = (input: AnalyticsFixture): CustomersAnalytics =>
  buildAnalyticsSection({
    section: "customers",
    ...commonInput(input),
    documents: input.documents,
    invoices: input.invoices,
    customerFirstPaid: input.customerFirstPaid,
  });

const inventoryAnswer = (input: AnalyticsFixture): InventoryAnalytics =>
  buildAnalyticsSection({
    section: "inventory",
    ...commonInput(input),
    stockRows: input.stockRows,
    basePrices: input.basePrices,
    sites: input.sites,
  });

const DAY = 86_400_000;
const uuidOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const SITE_A = uuidOf(0xa1);
const SITE_B = uuidOf(0xb1);
const P1 = uuidOf(0xc1);
const P2 = uuidOf(0xc2);
const P3 = uuidOf(0xc3);
const P4 = uuidOf(0xc4);
const NOW = new Date("2026-10-28T00:00:00.000Z");
const PERIOD = { from: new Date("2026-10-08T00:00:00.000Z"), to: new Date("2026-10-15T00:00:00.000Z") };

const PRICES: BasePrice[] = [
  { productId: P1, productName: "Paracetamol", unitPrice: 1000 },
  { productId: P2, productName: "Amoxicillin", unitPrice: 2500 },
  { productId: P3, productName: "Vitamin C", unitPrice: null },
];
const PRODUCTS: ProductClassification[] = [
  { productId: P1, productName: "Paracetamol", category: "Medicine", prescriptionRequired: false },
  { productId: P2, productName: "Amoxicillin", category: "Medicine", prescriptionRequired: true },
  { productId: P3, productName: "Vitamin C", category: null, prescriptionRequired: false },
];
const SITES: SiteName[] = [{ id: SITE_A, name: "Chi nhánh A" }];

const document = (
  n: number,
  kind: "order" | "prescription",
  siteId: string | null,
  createdAt: string,
  customerId: string | null = null,
): SalesDocument => ({ id: uuidOf(n), kind, siteId, customerId, createdAt });

const invoiceOf = (
  n: number,
  kind: "order" | "prescription",
  amount: number,
  lines: PaidInvoice["lines"] = [],
): PaidInvoice => ({
  orderId: kind === "order" ? uuidOf(n) : null,
  prescriptionId: kind === "prescription" ? uuidOf(n) : null,
  amount,
  createdAt: "2026-10-09T00:00:00.000Z",
  lines,
});

const line = (productId: string | null, quantity: number, unitPrice: number, description: string): SaleLine => ({
  productId,
  description,
  quantity,
  unitPrice,
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
const salesInput = (overrides: Partial<AnalyticsFixture> = {}): AnalyticsFixture => ({
  now: overrides.now ?? NOW,
  period: overrides.period ?? PERIOD,
  siteId: overrides.siteId ?? null,
  scope: overrides.scope,
  channel: overrides.channel ?? "all",
  documents: overrides.documents ?? [
    document(1, "order", SITE_A, "2026-10-09T10:00:00.000Z"),
    document(2, "prescription", SITE_A, "2026-10-10T10:00:00.000Z"),
    document(3, "order", SITE_B, "2026-10-12T10:00:00.000Z"),
    document(4, "order", null, "2026-10-11T10:00:00.000Z"),
    document(5, "order", SITE_A, "2026-10-08T00:00:00.000Z"),
    document(6, "order", SITE_A, "2026-10-15T00:00:00.000Z"),
    document(7, "order", SITE_A, "2026-10-03T10:00:00.000Z"),
    document(8, "prescription", SITE_B, "2026-10-07T12:00:00.000Z"),
  ],
  invoices: overrides.invoices ?? [
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
  customerFirstPaid: overrides.customerFirstPaid ?? [],
  dispenseCosts: overrides.dispenseCosts ?? [],
  stockRows: overrides.stockRows ?? [],
  basePrices: overrides.basePrices ?? PRICES,
  sites: overrides.sites ?? SITES,
  products: overrides.products ?? PRODUCTS,
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
    const answer = overviewAnswer(salesInput());
    // Current: 1, 2, 3, 4 and the document created exactly at `from` (5). Document 6 is at `to`, so it is out.
    expect(answer.kpis.revenue).toStrictEqual({ current: 390_000, previous: 120_000 });
    expect(answer.kpis.orderCount).toStrictEqual({ current: 5, previous: 2 });
  });

  it("averages revenue per sale, and answers null for an average over no sale", () => {
    const answer = overviewAnswer(salesInput());
    expect(answer.kpis.averageOrderValue).toStrictEqual({ current: 78_000, previous: 60_000 });
    expect(averageOrderValue({ revenue: 0, orderCount: 0 })).toBeNull();
    expect(averageOrderValue({ revenue: 10, orderCount: 4 })).toBe(3);
  });

  it("filters the sales KPIs by channel and lists both channels beside them", () => {
    const counter = overviewAnswer(salesInput({ channel: "counter" }));
    expect(counter.kpis.revenue.current).toBe(50_000);
    expect(counter.kpis.orderCount.current).toBe(1);
    expect(counter.channels).toStrictEqual([
      { channel: "counter", revenue: 50_000, orderCount: 1 },
      { channel: "online", revenue: 340_000, orderCount: 4 },
    ]);

    const online = overviewAnswer(salesInput({ channel: "online" }));
    expect(online.kpis.revenue).toStrictEqual({ current: 340_000, previous: 80_000 });
    expect(online.channels).toStrictEqual(counter.channels);
  });

  it("applies the requested site to the sales, and a scope excludes sites outside it and sales with no site", () => {
    const siteA = overviewAnswer(salesInput({ siteId: SITE_A }));
    expect(siteA.siteId).toBe(SITE_A);
    expect(siteA.kpis.revenue).toStrictEqual({ current: 160_000, previous: 80_000 });

    const scoped = overviewAnswer(salesInput({ scope: [SITE_A] }));
    expect(scoped.kpis.revenue.current).toBe(160_000);
    expect(scoped.kpis.orderCount.current).toBe(3);

    const outside = overviewAnswer(salesInput({ scope: [SITE_A], siteId: SITE_B }));
    expect(outside.kpis.revenue.current).toBe(0);
  });

  it("answers a null average when the filter leaves no sale in the period", () => {
    const answer = overviewAnswer(salesInput({ siteId: SITE_B, channel: "counter" }));
    expect(answer.kpis.orderCount.current).toBe(0);
    expect(answer.kpis.averageOrderValue).toStrictEqual({ current: null, previous: 40_000 });
  });

  it("answers no gross profit, with its reason, while no sale has a recorded cost", () => {
    expect(overviewAnswer(salesInput()).kpis.grossProfit).toStrictEqual({
      current: null,
      previous: null,
      available: false,
      reason: "no_cost_data",
      coverage: { current: 0, previous: 0 },
    });
  });

  it("reports the previous period beside the current one", () => {
    const answer = overviewAnswer(salesInput());
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

describe("overview daily series", () => {
  const sum = (points: { revenue: number; orders: number }[]) => ({
    revenue: points.reduce((total, point) => total + point.revenue, 0),
    orders: points.reduce((total, point) => total + point.orders, 0),
  });

  it("has one zero-filled point per day of each period, the previous one aligned day for day", () => {
    const { series } = overviewAnswer(salesInput());
    expect(series.current.map((point) => point.date)).toStrictEqual([
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ]);
    expect(series.previous.map((point) => point.date)).toStrictEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(series.current.some((point) => point.orders === 0 && point.revenue === 0)).toBe(true);
  });

  it("adds up to the overview revenue and order figures, under every site and channel filter", () => {
    for (const overrides of [
      {},
      { channel: "counter" as const },
      { channel: "online" as const },
      { siteId: SITE_A },
      { scope: [SITE_A] },
      { siteId: SITE_B, channel: "counter" as const },
    ]) {
      const answer = overviewAnswer(salesInput(overrides));
      expect(sum(answer.series.current)).toStrictEqual({
        revenue: answer.kpis.revenue.current,
        orders: answer.kpis.orderCount.current,
      });
      expect(sum(answer.series.previous)).toStrictEqual({
        revenue: answer.kpis.revenue.previous,
        orders: answer.kpis.orderCount.previous,
      });
    }
  });

  it("puts a sale on the day it was created, with `to` exclusive and `from` inclusive", () => {
    const sales = joinSales(salesInput().documents, salesInput().invoices);
    const points = dailySalesOf(sales, PERIOD, { siteId: null, scope: undefined }, "all");
    expect(points[0]?.orders).toBeGreaterThanOrEqual(1);
    expect(sum(points).orders).toBe(5);
  });
});

/** The keys every tab answers, so a test can assert that no other tab's figures came along. */
const ENVELOPE_KEYS = ["channel", "currency", "generatedAt", "period", "previousPeriod", "section", "siteId"];

describe("analytics sections", () => {
  it("answers the overview with the envelope, the tiles and both channels, and nothing of the other tabs", () => {
    const answer = overviewAnswer(salesInput());
    expect(Object.keys(answer).sort()).toStrictEqual([...ENVELOPE_KEYS, "channels", "kpis", "series"].sort());
    expect(answer.section).toBe("overview");
    expect(answer.currency).toBe("VND");
    expect(answer.channel).toBe("all");
    expect(answer.siteId).toBeNull();
    expect(answer.generatedAt).toBe(NOW.toISOString());
    expect(answer.period).toStrictEqual({ from: PERIOD.from.toISOString(), to: PERIOD.to.toISOString() });
    expect(answer.previousPeriod).toStrictEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" });
  });

  it("answers revenue with the breakdown alone", () => {
    const answer = revenueAnswer(breakdownInput());
    expect(Object.keys(answer).sort()).toStrictEqual([...ENVELOPE_KEYS, "breakdown"].sort());
    expect(answer.section).toBe("revenue");
    expect(answer.breakdown.goodsRevenue).toBe(220);
  });

  it("answers customers with the customer figures alone, from the first payment of each buyer", () => {
    const answer = customersAnswer(
      salesInput({
        documents: [document(1, "order", SITE_A, "2026-10-09T10:00:00.000Z", uuidOf(0x31))],
        customerFirstPaid: [{ customerId: uuidOf(0x31), firstPaidAt: "2026-10-09T00:00:00.000Z" }],
      }),
    );
    expect(Object.keys(answer).sort()).toStrictEqual([...ENVELOPE_KEYS, "customers"].sort());
    expect(answer.section).toBe("customers");
    expect(answer.customers.identifiedCustomerCount).toBe(1);
    expect(answer.customers.newCustomerCount).toBe(1);
    expect(answer.customers.identifiedRevenue).toBe(100_000);
  });

  it("answers inventory with stock health alone, and no sales read is needed for it", () => {
    const answer = inventoryAnswer(
      salesInput({ documents: [], invoices: [], stockRows: [stock({ onHand: 10, productId: P1 })] }),
    );
    expect(Object.keys(answer).sort()).toStrictEqual([...ENVELOPE_KEYS, "inventory"].sort());
    expect(answer.section).toBe("inventory");
    expect(answer.inventory.stockedProductCount).toBe(1);
    expect(answer.inventory.stockValue.total).toBe(10_000);
  });

  it("keeps the channel and site filters of each tab, and inventory ignores the channel", () => {
    const customers = customersAnswer(salesInput({ siteId: SITE_B, channel: "counter" }));
    expect(customers.siteId).toBe(SITE_B);
    expect(customers.channel).toBe("counter");
    expect(customers.customers.identifiedCustomerCount).toBe(0);

    const inventory = inventoryAnswer(
      salesInput({ channel: "online", scope: [SITE_A], stockRows: [stock({ onHand: 10 })] }),
    );
    expect(inventory.channel).toBe("online");
    expect(inventory.inventory.stockedProductCount).toBe(1);
  });
});

/**
 * The breakdown fixture. Documents 1 to 4 are sales of the current period at two sites, with one sale whose site is
 * unknown; 7 is a sale of the previous period. Document 1 carries a delivery fee line, and P4 is not in the catalog, so
 * it falls back to the description of its line and counts as an unknown prescription group.
 */
const breakdownInput = (overrides: Partial<AnalyticsFixture> = {}): AnalyticsFixture =>
  salesInput({
    documents: [
      document(1, "order", SITE_A, "2026-10-09T10:00:00.000Z"),
      document(2, "prescription", SITE_A, "2026-10-10T10:00:00.000Z"),
      document(3, "order", SITE_B, "2026-10-12T10:00:00.000Z"),
      document(4, "order", null, "2026-10-11T10:00:00.000Z"),
      document(7, "order", SITE_A, "2026-10-03T10:00:00.000Z"),
    ],
    invoices: [
      invoiceOf(1, "order", 100, [line(P1, 2, 30, "Paracetamol"), line(null, 1, 20, "Phí giao hàng")]),
      invoiceOf(2, "prescription", 50, [line(P2, 1, 50, "Amoxicillin")]),
      invoiceOf(3, "order", 80, [
        line(P1, 1, 30, "Paracetamol"),
        line(P3, 4, 10, "Vitamin C"),
        line(P4, 1, 10, "Hàng mới"),
      ]),
      invoiceOf(4, "order", 30, [line(P1, 1, 30, "Paracetamol")]),
      invoiceOf(7, "order", 80, [line(P2, 1, 80, "Amoxicillin")]),
    ],
    sites: [
      { id: SITE_A, name: "Chi nhánh A" },
      { id: SITE_B, name: "Chi nhánh B" },
    ],
    ...overrides,
  });

describe("sales breakdown", () => {
  it("adds the site rows up to the revenue tile, delivery fee included", () => {
    const answer = revenueAnswer(breakdownInput());
    // The revenue tile of the overview counts the same sales; the two tabs must add up to the same figure.
    expect(overviewAnswer(breakdownInput()).kpis.revenue.current).toBe(260);
    expect(answer.breakdown.bySite.map((row) => [row.siteName, row.revenue, row.orderCount])).toStrictEqual([
      ["Chi nhánh A", 150, 2],
      ["Chi nhánh B", 80, 1],
      [null, 30, 1],
    ]);
    expect(answer.breakdown.bySite.map((row) => row.averageOrderValue)).toStrictEqual([75, 80, 30]);
  });

  it("counts goods alone for the product tables, so the delivery fee is not attributed to a product", () => {
    const breakdown = revenueAnswer(breakdownInput()).breakdown;
    expect(breakdown.goodsRevenue).toBe(220);
    expect(breakdown.topProducts.map((row) => [row.productName, row.revenue])).toStrictEqual([
      ["Paracetamol", 120],
      ["Amoxicillin", 50],
      ["Vitamin C", 40],
      ["Hàng mới", 10],
    ]);
    expect(breakdown.topProducts[0]?.share).toBeCloseTo(120 / 220);
  });

  it("groups by the catalog category, merging an uncategorized product with one the catalog no longer lists", () => {
    const breakdown = revenueAnswer(breakdownInput()).breakdown;
    expect(breakdown.byCategory.map((row) => [row.category, row.revenue])).toStrictEqual([
      ["Medicine", 170],
      [null, 50],
    ]);
  });

  it("merges two spellings of one category, trimmed and ignoring case", () => {
    const input = breakdownInput();
    const breakdown = salesBreakdownOf({
      sales: joinSales(input.documents, input.invoices),
      linesByDocument: indexSaleLines(input.invoices),
      products: [
        { productId: P1, productName: "Paracetamol", category: "Medicine", prescriptionRequired: false },
        { productId: P2, productName: "Amoxicillin", category: " medicine ", prescriptionRequired: true },
        PRODUCTS[2] as ProductClassification,
      ],
      sites: input.sites,
      period: input.period,
      filter: { siteId: null, scope: undefined },
      channel: "all",
    });
    expect(breakdown.byCategory.map((row) => [row.category, row.revenue])).toStrictEqual([
      ["Medicine", 170],
      [null, 50],
    ]);
  });

  it("splits goods revenue by the current prescription flag, adding an unknown row only when a sold product is not listed", () => {
    const breakdown = revenueAnswer(breakdownInput()).breakdown;
    expect(breakdown.byPrescription).toStrictEqual([
      { group: "prescription", revenue: 50, share: 50 / 220 },
      { group: "otc", revenue: 160, share: 160 / 220 },
      { group: "unknown", revenue: 10, share: 10 / 220 },
    ]);
  });

  it("applies the channel filter to every breakdown table", () => {
    const online = revenueAnswer(breakdownInput({ channel: "online" })).breakdown;
    expect(online.bySite.map((row) => [row.siteName, row.revenue])).toStrictEqual([
      ["Chi nhánh A", 100],
      ["Chi nhánh B", 80],
      [null, 30],
    ]);
    expect(online.goodsRevenue).toBe(170);
    expect(online.byPrescription[0]).toStrictEqual({ group: "prescription", revenue: 0, share: 0 });

    const counter = revenueAnswer(breakdownInput({ channel: "counter" })).breakdown;
    expect(counter.goodsRevenue).toBe(50);
    expect(counter.bySite.map((row) => row.revenue)).toStrictEqual([50]);
    expect(counter.topProducts.map((row) => row.productName)).toStrictEqual(["Amoxicillin"]);
  });

  it("leaves out a site outside the caller's scope, and a sale with no site", () => {
    const scoped = revenueAnswer(breakdownInput({ scope: [SITE_A] })).breakdown;
    expect(scoped.bySite.map((row) => row.siteName)).toStrictEqual(["Chi nhánh A"]);
    expect(scoped.goodsRevenue).toBe(110);
    expect(scoped.topProducts.map((row) => [row.productName, row.revenue])).toStrictEqual([
      ["Paracetamol", 60],
      ["Amoxicillin", 50],
    ]);
  });

  it("answers empty tables and unanswered shares for a period with no sale", () => {
    const empty = revenueAnswer(
      breakdownInput({
        documents: [document(7, "order", SITE_A, "2026-10-03T10:00:00.000Z")],
      }),
    ).breakdown;
    expect(empty).toStrictEqual({
      goodsRevenue: 0,
      bySite: [],
      topProducts: [],
      abc: [
        { abcClass: "A", productCount: 0, revenue: 0, share: null },
        { abcClass: "B", productCount: 0, revenue: 0, share: null },
        { abcClass: "C", productCount: 0, revenue: 0, share: null },
      ],
      byCategory: [],
      byPrescription: [
        { group: "prescription", revenue: 0, share: null },
        { group: "otc", revenue: 0, share: null },
      ],
    });
  });

  it("gathers the lines of every paid invoice of one document", () => {
    const lines = indexSaleLines([
      invoiceOf(1, "order", 10, [line(P1, 1, 10, "Paracetamol")]),
      invoiceOf(1, "order", 20, [line(P2, 2, 10, "Amoxicillin")]),
    ]);
    expect(lines.get(uuidOf(1))?.map((row) => row.productId)).toStrictEqual([P1, P2]);
  });
});

describe("ABC classification", () => {
  it("cuts at 80% and 95% of cumulative goods revenue", () => {
    const rows = abcOf([
      { productId: P1, revenue: 800_000 },
      { productId: P2, revenue: 150_000 },
      { productId: P3, revenue: 50_000 },
    ]);

    expect(rows).toStrictEqual([
      { abcClass: "A", productCount: 1, revenue: 800_000, share: 0.8 },
      { abcClass: "B", productCount: 1, revenue: 150_000, share: 0.15 },
      { abcClass: "C", productCount: 1, revenue: 50_000, share: 0.05 },
    ]);
    expect(ABC_A_CUMULATIVE_SHARE).toBe(0.8);
    expect(ABC_B_CUMULATIVE_SHARE).toBe(0.95);
  });

  it("keeps the product that crosses a cut-off in the class it completes", () => {
    // 85% already passes A's cut-off, so the first product is A and the next 10% is B.
    const rows = abcOf([
      { productId: P1, revenue: 850_000 },
      { productId: P2, revenue: 100_000 },
      { productId: P3, revenue: 50_000 },
    ]);

    expect(rows.map((row) => [row.abcClass, row.productCount, row.revenue])).toStrictEqual([
      ["A", 1, 850_000],
      ["B", 1, 100_000],
      ["C", 1, 50_000],
    ]);
  });

  it("puts tied products in A when their combined share is still under the first cut-off", () => {
    const rows = abcOf([
      { productId: P1, revenue: 50_000 },
      { productId: P2, revenue: 50_000 },
    ]);

    expect(rows[0]).toStrictEqual({ abcClass: "A", productCount: 2, revenue: 100_000, share: 1 });
    expect(rows[1]?.productCount).toBe(0);
    expect(rows[2]?.productCount).toBe(0);
  });

  it("leaves products with no goods revenue out and answers no share when nothing sold", () => {
    const rows = abcOf([
      { productId: P1, revenue: 0 },
      { productId: P2, revenue: 0 },
    ]);

    expect(rows).toStrictEqual([
      { abcClass: "A", productCount: 0, revenue: 0, share: null },
      { abcClass: "B", productCount: 0, revenue: 0, share: null },
      { abcClass: "C", productCount: 0, revenue: 0, share: null },
    ]);
  });

  it("classifies the products of a period from their goods revenue", () => {
    const breakdown = revenueAnswer(
      breakdownInput({
        documents: [document(1, "order", SITE_A, "2026-10-09T10:00:00.000Z")],
        invoices: [invoiceOf(1, "order", 350, [line(P1, 3, 100, "Paracetamol"), line(P2, 1, 50, "Amoxicillin")])],
      }),
    ).breakdown;

    expect(breakdown.abc.map((row) => [row.abcClass, row.productCount, row.revenue])).toStrictEqual([
      ["A", 1, 300],
      ["B", 1, 50],
      ["C", 0, 0],
    ]);
  });
});

describe("customer insights", () => {
  const filter = { siteId: null, scope: undefined };
  const sale = (
    documentId: string,
    customerId: string | null,
    revenue: number,
    overrides: Partial<Sale> = {},
  ): Sale => ({
    documentId,
    channel: "online",
    siteId: SITE_A,
    customerId,
    createdAt: new Date("2026-10-09T10:00:00.000Z"),
    revenue,
    ...overrides,
  });

  it("counts identified customers, one-time and repeat buyers, the revenue share and the purchase frequency", () => {
    const answer = customerInsightsOf(
      [sale("1", "C1", 100), sale("2", "C1", 50), sale("3", "C2", 30), sale("4", null, 20)],
      PERIOD,
      filter,
      "all",
      new Map([
        ["C1", new Date("2026-09-01T00:00:00.000Z")],
        ["C2", new Date("2026-10-10T00:00:00.000Z")],
      ]),
    );

    expect(answer).toStrictEqual({
      identifiedCustomerCount: 2,
      oneTimeCustomerCount: 1,
      repeatCustomerCount: 1,
      identifiedRevenue: 180,
      identifiedShare: 0.9,
      purchasesPerCustomer: 1.5,
      newCustomerCount: 1,
      returningCustomerCount: 1,
    });
  });

  it("answers zeros, no share and no frequency for a period with no sale", () => {
    expect(customerInsightsOf([], PERIOD, filter, "all")).toStrictEqual({
      identifiedCustomerCount: 0,
      oneTimeCustomerCount: 0,
      repeatCustomerCount: 0,
      identifiedRevenue: 0,
      identifiedShare: null,
      purchasesPerCustomer: null,
      newCustomerCount: 0,
      returningCustomerCount: 0,
    });
  });

  it("counts no customer when every sale is a walk-in, and keeps the unnamed share at zero", () => {
    const answer = customerInsightsOf([sale("1", null, 100)], PERIOD, filter, "all");

    expect(answer.identifiedCustomerCount).toBe(0);
    expect(answer.identifiedRevenue).toBe(0);
    expect(answer.identifiedShare).toBe(0);
    expect(answer.purchasesPerCustomer).toBeNull();
    expect(answer.newCustomerCount).toBe(0);
    expect(answer.returningCustomerCount).toBe(0);
  });

  it("applies the site, channel and period filters", () => {
    const answer = customerInsightsOf(
      [
        sale("1", "C1", 100),
        sale("2", "C1", 50),
        sale("3", "C2", 30, { channel: "counter" }),
        sale("4", "C3", 40, { siteId: SITE_B }),
        sale("5", "C4", 60, { createdAt: new Date("2026-10-01T00:00:00.000Z") }),
      ],
      PERIOD,
      { siteId: SITE_A, scope: undefined },
      "online",
    );

    expect(answer.identifiedCustomerCount).toBe(1);
    expect(answer.identifiedRevenue).toBe(150);
    expect(answer.identifiedShare).toBe(1);
    expect(answer.purchasesPerCustomer).toBe(2);
    expect(answer.newCustomerCount).toBe(1);
    expect(answer.returningCustomerCount).toBe(0);
  });

  it("splits new from returning by the first payment ever, including one after the period", () => {
    const answer = customerInsightsOf(
      [sale("1", "C1", 10), sale("2", "C2", 10), sale("3", "C3", 10)],
      PERIOD,
      filter,
      "all",
      new Map([
        ["C1", new Date("2026-09-01T00:00:00.000Z")],
        ["C2", new Date("2026-10-09T00:00:00.000Z")],
        ["C3", new Date("2026-11-01T00:00:00.000Z")],
      ]),
    );

    expect(answer.newCustomerCount).toBe(2);
    expect(answer.returningCustomerCount).toBe(1);
  });
});

describe("sales targets", () => {
  const siteA = { id: SITE_A, name: "Nhà thuốc A" };
  const siteB = { id: SITE_B, name: "Nhà thuốc B" };
  const sale = (siteId: string | null, channel: "counter" | "online", revenue: number): Sale => ({
    documentId: `sale-${siteId}-${channel}-${revenue}`,
    channel,
    siteId,
    customerId: null,
    createdAt: new Date("2026-10-09T10:00:00.000Z"),
    revenue,
  });

  it("reports each site's paid revenue against its target, whatever the channel, and adds the rows up", () => {
    const report = buildSalesTargetsReport({
      month: "2026-10",
      period: PERIOD,
      siteId: null,
      scope: undefined,
      sites: [siteA, siteB],
      targets: [{ siteId: SITE_A, month: "2026-10", amount: 1000, currency: "VND" }],
      sales: [sale(SITE_A, "online", 500), sale(SITE_B, "counter", 300)],
    });

    expect(report.sites).toStrictEqual([
      { siteId: SITE_A, siteName: "Nhà thuốc A", target: 1000, revenue: 500, progress: 0.5 },
      { siteId: SITE_B, siteName: "Nhà thuốc B", target: null, revenue: 300, progress: null },
    ]);
    expect(report.totals).toStrictEqual({ target: 1000, revenue: 800, progress: 0.8 });
    expect(report.month).toBe("2026-10");
    expect(report.period).toStrictEqual({ from: PERIOD.from.toISOString(), to: PERIOD.to.toISOString() });
  });

  it("keeps the site filter and drops a target whose site is out of scope, never showing its revenue", () => {
    const report = buildSalesTargetsReport({
      month: "2026-10",
      period: PERIOD,
      siteId: null,
      scope: [SITE_A],
      sites: [siteA, siteB],
      targets: [
        { siteId: SITE_A, month: "2026-10", amount: 1000, currency: "VND" },
        { siteId: SITE_B, month: "2026-10", amount: 5000, currency: "VND" },
      ],
      sales: [sale(SITE_A, "online", 500), sale(SITE_B, "counter", 300), sale(null, "online", 200)],
    });

    expect(report.sites).toStrictEqual([
      { siteId: SITE_A, siteName: "Nhà thuốc A", target: 1000, revenue: 500, progress: 0.5 },
    ]);
    expect(report.totals).toStrictEqual({ target: 1000, revenue: 500, progress: 0.5 });
  });

  it("answers no progress when no site has a target, and lists every visible site", () => {
    const report = buildSalesTargetsReport({
      month: "2026-11",
      period: PERIOD,
      siteId: SITE_B,
      scope: undefined,
      sites: [siteA, siteB],
      targets: [],
      sales: [sale(SITE_B, "counter", 300)],
    });

    expect(report.sites).toStrictEqual([
      { siteId: SITE_B, siteName: "Nhà thuốc B", target: null, revenue: 300, progress: null },
    ]);
    expect(report.totals).toStrictEqual({ target: 0, revenue: 300, progress: null });
  });

  it("lists only the sites that sell: the warehouse, the hub and the headquarters are no row and add nothing", () => {
    const report = buildSalesTargetsReport({
      month: "2026-10",
      period: PERIOD,
      siteId: null,
      scope: undefined,
      sites: [
        { ...siteA, isCustomerFacing: true },
        { id: SITE_B, name: "Kho vệ tinh", isCustomerFacing: false },
      ],
      targets: [
        { siteId: SITE_A, month: "2026-10", amount: 1000, currency: "VND" },
        { siteId: SITE_B, month: "2026-10", amount: 5000, currency: "VND" },
      ],
      sales: [sale(SITE_A, "online", 500)],
    });

    expect(report.sites).toStrictEqual([
      { siteId: SITE_A, siteName: "Nhà thuốc A", target: 1000, revenue: 500, progress: 0.5 },
    ]);
    expect(report.totals).toStrictEqual({ target: 1000, revenue: 500, progress: 0.5 });
  });

  it("answers zero revenue and no target for a month with no sale, never a missing figure", () => {
    const report = buildSalesTargetsReport({
      month: "2026-12",
      period: PERIOD,
      siteId: null,
      scope: undefined,
      sites: [siteA],
      targets: [],
      sales: [],
    });

    expect(report.sites).toStrictEqual([
      { siteId: SITE_A, siteName: "Nhà thuốc A", target: null, revenue: 0, progress: null },
    ]);
    expect(report.totals).toStrictEqual({ target: 0, revenue: 0, progress: null });
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
      section: "overview",
      ...overrides,
    });

  it("accepts a period, a section, an optional site and a channel", () => {
    expect(query({ siteId: SITE_A, channel: "online" }).success).toBe(true);
    const parsed = query();
    expect(parsed.success && parsed.data).toStrictEqual({
      from: "2026-10-08T00:00:00.000Z",
      to: "2026-10-15T00:00:00.000Z",
      section: "overview",
    });
  });

  it("requires a section and accepts exactly the four tabs", () => {
    expect(query({ section: undefined }).success).toBe(false);
    for (const section of ANALYTICS_SECTIONS) expect(query({ section }).success).toBe(true);
    expect(query({ section: "all" }).success).toBe(false);
  });

  it("asks the targets route for a month instead of a section", () => {
    const targets = (overrides: Record<string, unknown> = {}) =>
      salesTargetQuerySchema.safeParse({
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-11-01T00:00:00.000Z",
        month: "2026-10",
        ...overrides,
      });
    expect(targets().success).toBe(true);
    expect(targets({ month: undefined }).success).toBe(false);
    expect(targets({ month: "2026-13" }).success).toBe(false);
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

const cost = (
  referenceType: "Order" | "Prescription",
  n: number,
  quantity: number,
  costedQuantity: number,
  amount: number,
): DispenseCost => ({ referenceType, referenceId: uuidOf(n), quantity, costedQuantity, cost: amount });

/**
 * Over the fixture of `salesInput`: sale 1 and prescription 2 are fully costed, sale 3 is costed for half of its goods,
 * sale 4 has no dispense row, sale 5 dispensed nothing; in the previous period sale 7 is costed and prescription 8 is not.
 */
const COSTS: DispenseCost[] = [
  cost("Order", 1, 10, 10, 40_000),
  cost("Prescription", 2, 5, 5, 20_000),
  cost("Order", 3, 4, 2, 5_000),
  cost("Order", 5, 0, 0, 0),
  cost("Order", 7, 3, 3, 30_000),
  cost("Prescription", 8, 2, 0, 0),
];

describe("gross profit", () => {
  it("is the revenue less the cost of the sales whose goods are all costed, beside the previous period", () => {
    const { grossProfit } = overviewAnswer(salesInput({ dispenseCosts: COSTS })).kpis;
    expect(grossProfit).toStrictEqual({
      current: 90_000,
      previous: 50_000,
      available: true,
      reason: null,
      coverage: { current: 150_000 / 390_000, previous: 80_000 / 120_000 },
    });
  });

  it("leaves out the revenue of a sale that is only partly costed instead of guessing the rest", () => {
    const answer = overviewAnswer(salesInput({ dispenseCosts: COSTS, siteId: SITE_B, channel: "online" }));
    // Only sale 3 is at site B in this period and it is half costed: no gross profit, never a figure from half the goods.
    expect(answer.kpis.revenue.current).toBe(200_000);
    expect(answer.kpis.grossProfit.current).toBeNull();
    expect(answer.kpis.grossProfit.reason).toBe("no_cost_data");
    expect(answer.kpis.grossProfit.coverage.current).toBe(0);
  });

  it("does not count a sale with no goods read, or one that dispensed nothing", () => {
    const sales = joinSales(salesInput().documents, salesInput().invoices);
    const costs = indexDispenseCosts([cost("Order", 4, 0, 0, 0), cost("Order", 5, 0, 0, 0)]);
    const profit = grossProfitOf(sales, costs, PERIOD, { siteId: null, scope: undefined }, "all");
    expect(profit.current).toBeNull();
  });

  it("matches a cost row to the right kind of document: an order id is not a prescription id", () => {
    const sales = joinSales(salesInput().documents, salesInput().invoices);
    const wrongKind = indexDispenseCosts([cost("Prescription", 1, 10, 10, 40_000)]);
    expect(grossProfitOf(sales, wrongKind, PERIOD, { siteId: null, scope: undefined }, "online").current).toBeNull();
  });

  it("follows the channel and site filters of the revenue", () => {
    const counter = overviewAnswer(salesInput({ dispenseCosts: COSTS, channel: "counter" })).kpis;
    expect(counter.revenue.current).toBe(50_000);
    expect(counter.grossProfit.current).toBe(30_000);
    expect(counter.grossProfit.coverage.current).toBe(1);
    // The previous counter sale is at site B and has no cost.
    expect(counter.grossProfit.previous).toBeNull();

    const scoped = overviewAnswer(salesInput({ dispenseCosts: COSTS, scope: [SITE_B] }));
    expect(scoped.kpis.grossProfit.current).toBeNull();
  });

  it("is a true zero, with no coverage, for a period with no sale", () => {
    const answer = overviewAnswer(salesInput({ dispenseCosts: COSTS, siteId: SITE_B, channel: "counter" }));
    expect(answer.kpis.grossProfit.current).toBe(0);
    expect(answer.kpis.grossProfit.available).toBe(true);
    expect(answer.kpis.grossProfit.coverage.current).toBeNull();
  });

  it("tolerates the rounding of decimal quantities summed across batches", () => {
    const sales = joinSales(salesInput().documents, salesInput().invoices);
    const costs = indexDispenseCosts([cost("Order", 1, 0.3, 0.1 + 0.2, 1_000)]);
    const profit = grossProfitOf(sales, costs, PERIOD, { siteId: null, scope: undefined }, "online");
    expect(profit.current).toBe(99_000);
  });

  it("never counts the revenue of an invoice that is not paid", () => {
    const withoutInvoice = overviewAnswer(
      salesInput({ dispenseCosts: COSTS, invoices: [invoiceOf(2, "prescription", 50_000)] }),
    );
    // Order 1 has no paid invoice, so it is no sale even though its goods were costed.
    expect(withoutInvoice.kpis.grossProfit.current).toBe(30_000);
  });

  it("rounds to whole dong", () => {
    const answer = overviewAnswer(
      salesInput({ dispenseCosts: [cost("Order", 1, 3, 3, 33_333.33)], channel: "online", siteId: SITE_A }),
    );
    expect(answer.kpis.grossProfit.current).toBe(66_667);
  });
});
