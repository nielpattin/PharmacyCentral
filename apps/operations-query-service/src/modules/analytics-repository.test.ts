import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OperationsDatabase } from "../shared/infrastructure/database.ts";
import { AnalyticsReadError, OperationsRepository } from "./operations-repository.ts";

const SITE = "00000000-0000-4000-8000-0000000000a1";
const ORDER = "00000000-0000-4000-8000-0000000000d1";
const NOW = new Date("2026-10-28T00:00:00.000Z");
const QUERY = {
  from: new Date("2026-10-08T00:00:00.000Z"),
  to: new Date("2026-10-15T00:00:00.000Z"),
  channel: "all" as const,
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The answers of the owning services, by `host/path`. An unlisted path answers an empty list. */
const defaultAnswers: Record<string, () => Response> = {
  "sales.test/internal/analytics/sales-documents": () =>
    json({ documents: [{ id: ORDER, kind: "order", siteId: SITE, createdAt: "2026-10-09T10:00:00.000Z" }] }),
  "payment.test/internal/analytics/paid-invoices": () =>
    json({
      invoices: [{ orderId: ORDER, prescriptionId: null, amount: 100_000, createdAt: "2026-10-09T10:05:00.000Z" }],
    }),
  "inventory.test/internal/analytics/stock-health": () =>
    json({ from: QUERY.from, to: QUERY.to, asOf: NOW, deadStockDays: 90, rows: [] }),
  "catalog.test/pricing/base-prices": () => json([]),
  "catalog.test/sites": () => json([{ id: SITE, name: "Chi nhánh A" }]),
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

  it("joins the owners' answers into the period figures, and reads each service with the right scope", async () => {
    const answer = await repository.dashboardAnalytics(QUERY, () => "signed-for-catalog", [SITE], NOW);
    expect(answer.kpis.revenue).toStrictEqual({ current: 100_000, previous: 0 });
    expect(answer.kpis.orderCount.current).toBe(1);

    const sales = requestTo("sales.test", "/internal/analytics/sales-documents");
    expect(sales?.url.searchParams.get("from")).toBe("2026-10-01T00:00:00.000Z");
    expect(sales?.url.searchParams.get("to")).toBe("2026-10-15T00:00:00.000Z");
    expect(sales?.headers.get("x-actor-site-ids")).toBe(SITE);
    expect(sales?.headers.get("x-internal-service-secret")).toBe("test-internal-secret");

    const invoices = requestTo("payment.test", "/internal/analytics/paid-invoices");
    expect(invoices?.url.searchParams.get("since")).toBe("2026-10-01T00:00:00.000Z");
    // payment-service is not site-bound, so it receives no scope header.
    expect(invoices?.headers.get("x-actor-site-ids")).toBeNull();

    const stock = requestTo("inventory.test", "/internal/analytics/stock-health");
    expect(stock?.url.searchParams.get("from")).toBe("2026-10-08T00:00:00.000Z");
    expect(stock?.headers.get("x-actor-site-ids")).toBe(SITE);

    expect(requestTo("catalog.test", "/pricing/base-prices")?.url.searchParams.get("day")).toBe("2026-10-28");
    expect(requestTo("catalog.test", "/sites")?.headers.get("x-internal-identity-context")).toBe("signed-for-catalog");
  });

  it("throws when a read fails, never an answer that leaves that service out", async () => {
    answers["sales.test/internal/analytics/sales-documents"] = () => new Response("boom", { status: 500 });
    const failed = repository.dashboardAnalytics(QUERY, () => "identity", undefined, NOW);
    await expect(failed).rejects.toBeInstanceOf(AnalyticsReadError);
  });

  it("keeps the owner's code when payment-service refuses the period as too large", async () => {
    answers["payment.test/internal/analytics/paid-invoices"] = () =>
      json({ title: "Too large", status: 422, code: "analytics_range_too_large" }, 422);
    const failed = repository.dashboardAnalytics(QUERY, () => "identity", undefined, NOW);
    await expect(failed).rejects.toMatchObject({ status: 422, code: "analytics_range_too_large" });
  });

  it("throws when an owner's answer does not have the contract's shape", async () => {
    answers["inventory.test/internal/analytics/stock-health"] = () => json({ rows: "not a list" });
    const failed = repository.dashboardAnalytics(QUERY, () => "identity", undefined, NOW);
    await expect(failed).rejects.toThrow();
  });

  it("throws when the payment URL is not configured, rather than leaving invoices out", async () => {
    const withoutPayment = new OperationsRepository({} as unknown as OperationsDatabase, {
      catalogUrl: "http://catalog.test",
      inventoryUrl: "http://inventory.test",
      salesUrl: "http://sales.test",
    });
    await expect(withoutPayment.dashboardAnalytics(QUERY, () => "identity", undefined, NOW)).rejects.toThrow(
      /has no service URL configured/,
    );
  });
});
