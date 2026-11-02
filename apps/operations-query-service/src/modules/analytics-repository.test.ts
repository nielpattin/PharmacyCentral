import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OperationsDatabase } from "../shared/infrastructure/database.ts";
import { AnalyticsReadError, OperationsRepository, type AnalyticsQuery } from "./operations-repository.ts";

const SITE = "00000000-0000-4000-8000-0000000000a1";
const ORDER = "00000000-0000-4000-8000-0000000000d1";
const PRODUCT = "00000000-0000-4000-8000-0000000000f1";
const CUSTOMER = "00000000-0000-4000-8000-0000000000c1";
const NOW = new Date("2026-10-28T00:00:00.000Z");
const PERIOD = {
  from: new Date("2026-10-08T00:00:00.000Z"),
  to: new Date("2026-10-15T00:00:00.000Z"),
};

/** The query of one tab; every read of it starts from here. */
const queryOf = (section: AnalyticsQuery["section"], siteId?: string): AnalyticsQuery => ({
  section,
  from: PERIOD.from,
  to: PERIOD.to,
  channel: "all",
  siteId,
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The answers of the owning services, by `host/path`. An unlisted path answers an empty list. */
const defaultAnswers: Record<string, () => Response> = {
  "sales.test/internal/analytics/sales-documents": () =>
    json({
      documents: [{ id: ORDER, kind: "order", siteId: SITE, customerId: null, createdAt: "2026-10-09T10:00:00.000Z" }],
    }),
  "sales.test/internal/analytics/customer-first-paid": () => json({ customers: [] }),
  "sales.test/internal/analytics/sales-targets": () =>
    json({ targets: [{ siteId: SITE, month: "2026-10", amount: 1_000_000, currency: "VND" }] }),
  "payment.test/internal/analytics/paid-invoices": () =>
    json({
      invoices: [
        {
          orderId: ORDER,
          prescriptionId: null,
          amount: 100_000,
          createdAt: "2026-10-09T10:05:00.000Z",
          lines: [
            { productId: PRODUCT, description: "Paracetamol", quantity: 2, unitPrice: 45_000 },
            { productId: null, description: "Phí giao hàng", quantity: 1, unitPrice: 10_000 },
          ],
        },
      ],
    }),
  "inventory.test/internal/analytics/dispense-costs": () =>
    json({
      since: "2026-09-24T00:00:00.000Z",
      rows: [{ referenceType: "Order", referenceId: ORDER, quantity: 4, costedQuantity: 4, cost: 30_000 }],
    }),
  "inventory.test/internal/analytics/stock-health": () =>
    json({ from: PERIOD.from, to: PERIOD.to, asOf: NOW, deadStockDays: 90, rows: [] }),
  "catalog.test/pricing/base-prices": () => json([]),
  "catalog.test/sites": () => json([{ id: SITE, name: "Chi nhánh A" }]),
  "catalog.test/internal/analytics/products": () =>
    json({
      products: [{ productId: PRODUCT, productName: "Paracetamol", category: "Medicine", prescriptionRequired: false }],
    }),
};

describe("OperationsRepository.dashboardAnalytics", () => {
  let answers: Record<string, () => Response>;
  let seen: Array<{ url: URL; headers: Headers }>;
  const repository = new OperationsRepository({} as unknown as OperationsDatabase, {
    catalogUrl: "http://catalog.test",
    inventoryUrl: "http://inventory.test",
    salesUrl: "http://sales.test",
    paymentUrl: "http://payment.test",
  });

  beforeEach(() => {
    answers = { ...defaultAnswers };
    seen = [];
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      seen.push({ url, headers: new Headers(init?.headers) });
      const answer = answers[`${url.host}${url.pathname}`];
      return answer ? answer() : json([]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const requestTo = (host: string, pathname: string) =>
    seen.find((request) => request.url.host === host && request.url.pathname === pathname);

  /** Every read the tab made, so a test can assert that the reads of the other tabs did not happen. */
  const readPaths = () => seen.map((request) => `${request.url.host}${request.url.pathname}`).sort();

  it("answers the overview from the sales, their paid invoices and their cost, and reads nothing else", async () => {
    const answer = await repository.dashboardAnalytics(queryOf("overview"), () => "Bearer employee-token", [SITE], NOW);

    expect(answer.section).toBe("overview");
    expect(answer.currency).toBe("VND");
    expect(answer.channel).toBe("all");
    expect(answer.siteId).toBeNull();
    expect(answer.generatedAt).toBe(NOW.toISOString());
    expect(answer).not.toHaveProperty("breakdown");
    expect(answer).not.toHaveProperty("customers");
    expect(answer).not.toHaveProperty("inventory");
    if (answer.section !== "overview") throw new Error("the overview tab must answer its tiles");
    expect(answer.kpis.revenue).toStrictEqual({ current: 100_000, previous: 0 });
    expect(answer.kpis.orderCount.current).toBe(1);
    expect(answer.kpis.grossProfit).toMatchObject({ current: 70_000, available: true, reason: null });
    expect(answer.channels).toStrictEqual([
      { channel: "counter", revenue: 0, orderCount: 0 },
      { channel: "online", revenue: 100_000, orderCount: 1 },
    ]);

    expect(readPaths()).toStrictEqual([
      "inventory.test/internal/analytics/dispense-costs",
      "payment.test/internal/analytics/paid-invoices",
      "sales.test/internal/analytics/sales-documents",
    ]);

    const costs = requestTo("inventory.test", "/internal/analytics/dispense-costs");
    // The cost read starts with the previous period, like the sales it is joined to, and is not site-bound.
    expect(costs?.url.searchParams.get("since")).toBe("2026-10-01T00:00:00.000Z");
    expect(costs?.headers.get("x-actor-site-ids")).toBeNull();
    expect(costs?.headers.get("x-internal-service-secret")).toBe("test-internal-secret");

    const sales = requestTo("sales.test", "/internal/analytics/sales-documents");
    expect(sales?.url.searchParams.get("from")).toBe("2026-10-01T00:00:00.000Z");
    expect(sales?.url.searchParams.get("to")).toBe("2026-10-15T00:00:00.000Z");
    expect(sales?.headers.get("x-actor-site-ids")).toBe(SITE);
    expect(sales?.headers.get("x-internal-service-secret")).toBe("test-internal-secret");

    const invoices = requestTo("payment.test", "/internal/analytics/paid-invoices");
    expect(invoices?.url.searchParams.get("since")).toBe("2026-10-01T00:00:00.000Z");
    // payment-service is not site-bound, so it receives no scope header.
    expect(invoices?.headers.get("x-actor-site-ids")).toBeNull();
  });

  it("answers the revenue tab from the period's sales and the catalog, and reads no stock nor customer source", async () => {
    const answer = await repository.dashboardAnalytics(queryOf("revenue"), () => "Bearer employee-token", [SITE], NOW);

    expect(answer.section).toBe("revenue");
    expect(answer).not.toHaveProperty("kpis");
    expect(answer).not.toHaveProperty("inventory");
    if (answer.section !== "revenue") throw new Error("the revenue tab must answer its breakdown");
    expect(answer.breakdown.goodsRevenue).toBe(90_000);
    expect(answer.breakdown.bySite).toStrictEqual([
      { siteId: SITE, siteName: "Chi nhánh A", revenue: 100_000, orderCount: 1, averageOrderValue: 100_000 },
    ]);
    expect(answer.breakdown.topProducts).toStrictEqual([
      { productId: PRODUCT, productName: "Paracetamol", revenue: 90_000, share: 1 },
    ]);
    expect(answer.breakdown.byPrescription).toStrictEqual([
      { group: "prescription", revenue: 0, share: 0 },
      { group: "otc", revenue: 90_000, share: 1 },
    ]);

    expect(readPaths()).toStrictEqual([
      "catalog.test/internal/analytics/products",
      "catalog.test/sites",
      "payment.test/internal/analytics/paid-invoices",
      "sales.test/internal/analytics/sales-documents",
    ]);
    // The breakdown covers the period alone: it is bucketed by the document's own date, not by the previous period.
    expect(requestTo("sales.test", "/internal/analytics/sales-documents")?.url.searchParams.get("from")).toBe(
      "2026-10-08T00:00:00.000Z",
    );
    expect(requestTo("payment.test", "/internal/analytics/paid-invoices")?.url.searchParams.get("since")).toBe(
      "2026-10-08T00:00:00.000Z",
    );
    expect(requestTo("catalog.test", "/sites")?.headers.get("authorization")).toBe("Bearer employee-token");
  });

  it("answers the customers tab from the period's sales and their first payment, and reads no stock nor catalog", async () => {
    answers["sales.test/internal/analytics/sales-documents"] = () =>
      json({
        documents: [
          { id: ORDER, kind: "order", siteId: SITE, customerId: CUSTOMER, createdAt: "2026-10-09T10:00:00.000Z" },
        ],
      });
    answers["sales.test/internal/analytics/customer-first-paid"] = () =>
      json({ customers: [{ customerId: CUSTOMER, firstPaidAt: "2026-10-09T00:00:00.000Z" }] });

    const answer = await repository.dashboardAnalytics(queryOf("customers"), () => "identity", [SITE], NOW);

    expect(answer.section).toBe("customers");
    expect(answer).not.toHaveProperty("kpis");
    if (answer.section !== "customers") throw new Error("the customers tab must answer its customer figures");
    expect(answer.customers).toMatchObject({
      identifiedCustomerCount: 1,
      newCustomerCount: 1,
      returningCustomerCount: 0,
      identifiedRevenue: 100_000,
    });

    expect(readPaths()).toStrictEqual([
      "payment.test/internal/analytics/paid-invoices",
      "sales.test/internal/analytics/customer-first-paid",
      "sales.test/internal/analytics/sales-documents",
    ]);
    const firstPaid = requestTo("sales.test", "/internal/analytics/customer-first-paid");
    expect(firstPaid?.url.searchParams.get("from")).toBe("2026-10-08T00:00:00.000Z");
    expect(firstPaid?.url.searchParams.get("to")).toBe("2026-10-15T00:00:00.000Z");
    expect(firstPaid?.headers.get("x-actor-site-ids")).toBe(SITE);
  });

  it("answers the inventory tab from stock health and today's prices, and reads no sales source", async () => {
    answers["inventory.test/internal/analytics/stock-health"] = () =>
      json({
        from: PERIOD.from,
        to: PERIOD.to,
        asOf: NOW,
        deadStockDays: 90,
        rows: [
          {
            siteId: SITE,
            productId: PRODUCT,
            onHand: 5,
            reserved: 0,
            dispensed: 2,
            netChange: 1,
            lastMovementAt: "2026-10-09T00:00:00.000Z",
            expired: 0,
            expiring30: 0,
            expiring60: 0,
            expiring90: 0,
          },
        ],
      });
    answers["catalog.test/pricing/base-prices"] = () =>
      json([{ productId: PRODUCT, productName: "Paracetamol", unitPrice: 1_000 }]);

    const answer = await repository.dashboardAnalytics(
      queryOf("inventory"),
      () => "Bearer employee-token",
      [SITE],
      NOW,
    );

    expect(answer.section).toBe("inventory");
    expect(answer).not.toHaveProperty("kpis");
    if (answer.section !== "inventory") throw new Error("the inventory tab must answer its stock health");
    expect(answer.inventory.stockedProductCount).toBe(1);
    expect(answer.inventory.stockValue.total).toBe(5_000);

    expect(readPaths()).toStrictEqual([
      "catalog.test/pricing/base-prices",
      "catalog.test/sites",
      "inventory.test/internal/analytics/stock-health",
    ]);
    const stock = requestTo("inventory.test", "/internal/analytics/stock-health");
    expect(stock?.url.searchParams.get("from")).toBe("2026-10-08T00:00:00.000Z");
    expect(stock?.headers.get("x-actor-site-ids")).toBe(SITE);
    expect(requestTo("catalog.test", "/pricing/base-prices")?.url.searchParams.get("day")).toBe("2026-10-28");
    expect(requestTo("catalog.test", "/sites")?.headers.get("authorization")).toBe("Bearer employee-token");
  });

  it("still answers the month's revenue against each site's target", async () => {
    const targetReport = await repository.salesTargetsReport(
      { month: "2026-10", from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-11-01T00:00:00.000Z") },
      () => "Bearer employee-token",
      [SITE],
    );
    expect(targetReport.sites).toStrictEqual([
      { siteId: SITE, siteName: "Chi nhánh A", target: 1_000_000, revenue: 100_000, progress: 0.1 },
    ]);
    expect(targetReport.totals).toStrictEqual({ target: 1_000_000, revenue: 100_000, progress: 0.1 });
    const targets = requestTo("sales.test", "/internal/analytics/sales-targets");
    expect(targets?.url.searchParams.get("month")).toBe("2026-10");
    expect(targets?.headers.get("x-actor-site-ids")).toBe(SITE);
    expect(requestTo("sales.test", "/internal/analytics/sales-documents")?.url.searchParams.get("from")).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("throws when a read fails, never an answer that leaves that service out", async () => {
    answers["sales.test/internal/analytics/sales-documents"] = () => new Response("boom", { status: 500 });
    const failed = repository.dashboardAnalytics(queryOf("overview"), () => "identity", undefined, NOW);
    await expect(failed).rejects.toBeInstanceOf(AnalyticsReadError);
  });

  it("keeps the owner's code when payment-service refuses the period as too large", async () => {
    answers["payment.test/internal/analytics/paid-invoices"] = () =>
      json({ title: "Too large", status: 422, code: "analytics_range_too_large" }, 422);
    const failed = repository.dashboardAnalytics(queryOf("revenue"), () => "identity", undefined, NOW);
    await expect(failed).rejects.toMatchObject({ status: 422, code: "analytics_range_too_large" });
  });

  it("throws when the dispense costs cannot be read, rather than showing a gross profit without them", async () => {
    answers["inventory.test/internal/analytics/dispense-costs"] = () =>
      json({ title: "Too large", status: 422, code: "analytics_range_too_large" }, 422);
    const failed = repository.dashboardAnalytics(queryOf("overview"), () => "identity", undefined, NOW);
    await expect(failed).rejects.toMatchObject({ status: 422, code: "analytics_range_too_large" });
  });

  it("throws when an owner's answer does not have the contract's shape", async () => {
    answers["inventory.test/internal/analytics/stock-health"] = () => json({ rows: "not a list" });
    const failed = repository.dashboardAnalytics(queryOf("inventory"), () => "identity", undefined, NOW);
    await expect(failed).rejects.toThrow();
  });

  it("throws when the payment URL is not configured, rather than leaving invoices out", async () => {
    const withoutPayment = new OperationsRepository({} as unknown as OperationsDatabase, {
      catalogUrl: "http://catalog.test",
      inventoryUrl: "http://inventory.test",
      salesUrl: "http://sales.test",
    });
    await expect(
      withoutPayment.dashboardAnalytics(queryOf("customers"), () => "identity", undefined, NOW),
    ).rejects.toThrow(/has no service URL configured/);
  });
});
