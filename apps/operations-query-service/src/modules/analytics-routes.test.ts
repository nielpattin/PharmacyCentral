import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createOperationsRouter } from "./operations-routes.ts";
import { AnalyticsReadError, type AnalyticsQuery, type OperationsRepository } from "./operations-repository.ts";

const SITE = "00000000-0000-4000-8000-0000000000a1";
const OTHER_SITE = "00000000-0000-4000-8000-0000000000b1";
const THREE_DAYS = 3 * 86_400_000;
const BASE_DAY = Date.UTC(2025, 0, 1);

type TargetQuery = { month: string; from: Date; to: Date; siteId?: string | undefined };

const RANKED_PRODUCTS = Array.from({ length: 45 }, (_, index) => ({
  productId: `p${index}`,
  productName: `Product ${index}`,
  revenue: 1000 - index,
  share: null,
  abcClass: index < 10 ? "A" : index < 25 ? "B" : "C",
}));

describe("GET /dashboard/analytics", () => {
  const calls: Array<{ query: AnalyticsQuery; siteIds: string[] | undefined }> = [];
  const targetCalls: Array<{ query: TargetQuery; siteIds: string[] | undefined }> = [];
  let failure: unknown;
  /** A load waits on this gate while it is set, so a test can keep two requests in flight at once. */
  let loadGate: Promise<void> | undefined;
  const repository = {
    dashboardAnalytics: async (query: AnalyticsQuery, _identity: () => string, siteIds: string[] | undefined) => {
      calls.push({ query, siteIds });
      await loadGate;
      if (failure !== undefined) throw failure;
      const answer = { section: query.section, currency: "VND", siteId: query.siteId ?? null };
      // The revenue answer carries every ranked product; the router cuts the requested page from it.
      return query.section === "revenue"
        ? { ...answer, breakdown: { goodsRevenue: 0, products: RANKED_PRODUCTS } }
        : answer;
    },
    salesTargetsReport: async (query: TargetQuery, _identity: () => string, siteIds: string[] | undefined) => {
      targetCalls.push({ query, siteIds });
      await loadGate;
      if (failure !== undefined) throw failure;
      return { month: query.month, currency: "VND", sites: [] };
    },
  } as unknown as OperationsRepository;

  const app = express();
  /** A request that announces itself lets a test know the router has it, without guessing a delay. */
  const arrivals = new Map<string, () => void>();
  app.use((request, _response, next) => {
    const marker = request.header("x-test-arrival");
    if (marker !== undefined) arrivals.get(marker)?.();
    next();
  });
  app.use(createOperationsRouter(repository));
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = app.listen(0, "127.0.0.1");
    const listening = Promise.withResolvers<void>();
    server.once("listening", () => listening.resolve());
    await listening.promise;
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    await closed.promise;
  });

  beforeEach(() => {
    calls.length = 0;
    targetCalls.length = 0;
    arrivals.clear();
    failure = undefined;
    loadGate = undefined;
  });

  /** A period no other request uses, so a cached row of one test never answers another. */
  let periods = 0;
  const freshPeriod = (): { from: string; to: string } => {
    periods += 1;
    const from = new Date(BASE_DAY + periods * THREE_DAYS);
    return { from: from.toISOString(), to: new Date(from.getTime() + THREE_DAYS).toISOString() };
  };

  const analyticsPath = (options: {
    section?: string | undefined;
    siteId?: string | undefined;
    channel?: string | undefined;
  }): string => {
    const query = new URLSearchParams(freshPeriod());
    if (options.section !== undefined) query.set("section", options.section);
    if (options.siteId !== undefined) query.set("siteId", options.siteId);
    if (options.channel !== undefined) query.set("channel", options.channel);
    return `/dashboard/analytics?${query.toString()}`;
  };

  /** The targets path of one period, with the month a test asks for (or none at all). */
  const targetsPath = (period: { from: string; to: string }, month?: string): string => {
    const query = new URLSearchParams(period);
    if (month !== undefined) query.set("month", month);
    return `/dashboard/sales-targets?${query.toString()}`;
  };

  const get = (path: string, roles: string | undefined, actorType = "employee", scope?: string, arrival?: string) =>
    fetch(`${base}${path}`, {
      headers: {
        "X-Actor-Type": actorType,
        ...(roles === undefined ? {} : { "X-Actor-Roles": roles }),
        ...(scope === undefined ? {} : { "X-Actor-Site-Ids": scope }),
        ...(arrival === undefined ? {} : { "X-Test-Arrival": arrival }),
      },
    });

  it.each(["overview", "revenue", "customers", "inventory"])(
    "answers the %s section the repository loaded",
    async (section) => {
      const response = await get(analyticsPath({ section }), "Pharmacy Manager");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ section, currency: "VND" });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.query.section).toBe(section);
      expect(response.headers.get("x-analytics-cache")).toBe("miss");
    },
  );

  it("answers one page of the ranked products, narrowed to an ABC class when asked", async () => {
    const period = freshPeriod();
    const ask = async (extra: Record<string, string>) =>
      (await get(
        `/dashboard/analytics?${new URLSearchParams({ ...period, section: "revenue", ...extra }).toString()}`,
        "Pharmacy Manager",
      ).then((response) => response.json())) as {
        breakdown: { products: { rows: { abcClass: string }[]; total: number; page: number } };
      };
    const first = await ask({});
    expect(first.breakdown.products).toMatchObject({ total: 45, page: 1 });
    expect(first.breakdown.products.rows).toHaveLength(20);
    const classC = await ask({ productClass: "C", productPage: "2" });
    expect(classC.breakdown.products.total).toBe(20);
    expect(classC.breakdown.products.rows.every((row) => row.abcClass === "C")).toBe(true);
    // Turning the page or the class reads the cache, not the services again.
    expect(calls).toHaveLength(1);
  });

  it("answers a Pharmacy Manager with the period and the default channel", async () => {
    const period = freshPeriod();
    const response = await get(
      `/dashboard/analytics?${new URLSearchParams({ ...period, section: "overview" }).toString()}`,
      "Pharmacy Manager",
    );
    expect(response.status).toBe(200);
    expect(calls[0]?.query.from).toStrictEqual(new Date(period.from));
    expect(calls[0]?.query.to).toStrictEqual(new Date(period.to));
    expect(calls[0]?.query.channel).toBe("all");
    expect(calls[0]?.query.siteId).toBeUndefined();
  });

  it("passes the requested channel and site, inside the caller's scope", async () => {
    const response = await get(
      analyticsPath({ section: "revenue", channel: "online", siteId: SITE }),
      "Pharmacy Manager",
      "employee",
      SITE,
    );
    expect(response.status).toBe(200);
    expect(calls[0]?.query).toMatchObject({ section: "revenue", channel: "online", siteId: SITE });
    expect(calls[0]?.siteIds).toStrictEqual([SITE]);
  });

  it("passes the assigned sites of a site-scoped manager when no site is asked for", async () => {
    await get(analyticsPath({ section: "overview" }), "Pharmacy Manager", "employee", `${SITE},${OTHER_SITE}`);
    expect(calls[0]?.siteIds).toStrictEqual([SITE, OTHER_SITE]);
  });

  it.each(["Platform Admin", "Warehouse Staff", "Pharmacist"])("refuses %s before reading anything", async (role) => {
    const response = await get(analyticsPath({ section: "overview" }), role);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a caller with no employee role header, and a service caller", async () => {
    expect((await get(analyticsPath({ section: "overview" }), undefined)).status).toBe(403);
    expect((await get(analyticsPath({ section: "overview" }), "Platform Admin", "system")).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  /** One query per refusal: the section, the period, the site and the channel each have their own. */
  const invalidQueries = (): Array<[string, Record<string, string>]> => {
    const { from, to } = freshPeriod();
    return [
      ["no section", { from, to }],
      ["a section that is not a tab", { from, to, section: "all" }],
      ["no from", { to, section: "overview" }],
      ["to not after from", { from: to, to: from, section: "overview" }],
      [
        "a period over 366 days",
        { from, to: new Date(Date.parse(from) + 400 * 86_400_000).toISOString(), section: "overview" },
      ],
      ["a date without a time", { from: "2026-10-08", to: "2026-10-15", section: "overview" }],
      ["a site id that is not a UUID", { from, to, section: "overview", siteId: "abc" }],
      ["a channel outside all, counter, online", { from, to, section: "overview", channel: "web" }],
    ];
  };

  it.each(invalidQueries())("answers 400 for %s before reading anything", async (_label, query) => {
    const response = await get(`/dashboard/analytics?${new URLSearchParams(query).toString()}`, "Pharmacy Manager");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: 400, code: "invalid_request" });
    expect(response.headers.get("x-analytics-cache")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("names the four sections when the request has none", async () => {
    const response = await get(analyticsPath({}), "Pharmacy Manager");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      detail: expect.stringMatching(/overview.*revenue.*customers.*inventory/),
    });
  });

  it("answers a repeated identical request from the cache, and marks the outcome", async () => {
    const path = analyticsPath({ section: "customers" });
    const first = await get(path, "Pharmacy Manager");
    const second = await get(path, "Pharmacy Manager");
    expect(first.headers.get("x-analytics-cache")).toBe("miss");
    expect(second.headers.get("x-analytics-cache")).toBe("hit");
    expect(await second.json()).toStrictEqual(await first.json());
    expect(calls).toHaveLength(1);
  });

  it("coalesces concurrent identical requests into one load", async () => {
    const path = analyticsPath({ section: "revenue" });
    const gate = Promise.withResolvers<void>();
    const firstArrival = Promise.withResolvers<void>();
    const secondArrival = Promise.withResolvers<void>();
    arrivals.set("first", () => firstArrival.resolve());
    arrivals.set("second", () => secondArrival.resolve());
    loadGate = gate.promise;
    const first = get(path, "Pharmacy Manager", "employee", undefined, "first");
    await firstArrival.promise;
    // The first request's load is still waiting on the gate, so the second identical request joins that load.
    const second = get(path, "Pharmacy Manager", "employee", undefined, "second");
    await secondArrival.promise;
    gate.resolve();
    const responses = await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    expect(responses.map((response) => response.headers.get("x-analytics-cache")).sort()).toStrictEqual([
      "coalesced",
      "miss",
    ]);
  });

  it("keeps two callers of different site scopes apart, whatever the order of their scope", async () => {
    const path = analyticsPath({ section: "inventory" });
    await get(path, "Pharmacy Manager", "employee", SITE);
    const other = await get(path, "Pharmacy Manager", "employee", OTHER_SITE);
    expect(other.headers.get("x-analytics-cache")).toBe("miss");
    expect(calls.map((call) => call.siteIds)).toStrictEqual([[SITE], [OTHER_SITE]]);

    // The same scope in another order is the same caller, so the sorted key answers from the cache.
    const both = await get(path, "Pharmacy Manager", "employee", `${SITE},${OTHER_SITE}`);
    expect(both.headers.get("x-analytics-cache")).toBe("miss");
    const reordered = await get(path, "Pharmacy Manager", "employee", `${OTHER_SITE},${SITE}`);
    expect(reordered.headers.get("x-analytics-cache")).toBe("hit");
    expect(calls).toHaveLength(3);
  });

  it("never caches an error: a 422 is answered, and the next request loads again", async () => {
    const path = analyticsPath({ section: "overview" });
    failure = new AnalyticsReadError("/internal/analytics/paid-invoices", 422, "analytics_range_too_large");
    const failed = await get(path, "Pharmacy Manager");
    expect(failed.status).toBe(422);
    expect(await failed.json()).toMatchObject({ status: 422, code: "analytics_range_too_large" });
    expect(failed.headers.get("x-analytics-cache")).toBeNull();

    failure = undefined;
    const retried = await get(path, "Pharmacy Manager");
    expect(retried.status).toBe(200);
    expect(retried.headers.get("x-analytics-cache")).toBe("miss");
    expect(calls).toHaveLength(2);
  });

  it("answers 500 for any other failed read, never a partial figure", async () => {
    failure = new AnalyticsReadError("/internal/analytics/stock-health", 500, undefined);
    const response = await get(analyticsPath({ section: "inventory" }), "Pharmacy Manager");
    expect(response.status).toBe(500);
    expect(response.headers.get("x-analytics-cache")).toBeNull();
  });

  it("reads the sales targets on every request, with the caller's scope, and never caches them", async () => {
    const path = targetsPath(freshPeriod(), "2026-10");
    const first = await get(path, "Pharmacy Manager", "employee", SITE);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-analytics-cache")).toBeNull();
    const second = await get(path, "Pharmacy Manager", "employee", SITE);
    expect(second.headers.get("x-analytics-cache")).toBeNull();
    // A target changed by `PUT /api/sales-targets` must show at once, so the route reads again instead of answering a
    // cached row.
    expect(targetCalls).toHaveLength(2);
    expect(targetCalls.map((call) => call.siteIds)).toStrictEqual([[SITE], [SITE]]);
    expect(targetCalls[0]?.query.month).toBe("2026-10");

    const otherScope = await get(path, "Pharmacy Manager", "employee", OTHER_SITE);
    expect(otherScope.headers.get("x-analytics-cache")).toBeNull();
    expect(targetCalls.map((call) => call.siteIds)).toStrictEqual([[SITE], [SITE], [OTHER_SITE]]);
  });

  it("passes the month of the targets, and refuses a missing one", async () => {
    const period = freshPeriod();
    await get(targetsPath(period, "2026-10"), "Pharmacy Manager");
    await get(targetsPath(period, "2026-11"), "Pharmacy Manager");
    expect(targetCalls.map((call) => call.query.month)).toStrictEqual(["2026-10", "2026-11"]);

    const missing = targetsPath(period);
    const response = await get(missing, "Pharmacy Manager");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: 400, code: "invalid_request" });
    expect(targetCalls).toHaveLength(2);
  });
});
