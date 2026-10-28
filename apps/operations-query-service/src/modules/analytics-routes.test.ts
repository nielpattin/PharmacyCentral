import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createOperationsRouter } from "./operations-routes.ts";
import { AnalyticsReadError, type AnalyticsQuery, type OperationsRepository } from "./operations-repository.ts";

const SITE = "00000000-0000-4000-8000-0000000000a1";
const OTHER_SITE = "00000000-0000-4000-8000-0000000000b1";
const PATH = "/dashboard/analytics?from=2026-10-08T00:00:00.000Z&to=2026-10-15T00:00:00.000Z";

describe("GET /dashboard/analytics", () => {
  const calls: Array<{ query: AnalyticsQuery; siteIds: string[] | undefined }> = [];
  let failure: unknown;
  const repository = {
    dashboardAnalytics: (query: AnalyticsQuery, _identity: () => string, siteIds: string[] | undefined) => {
      calls.push({ query, siteIds });
      if (failure !== undefined) return Promise.reject(failure);
      return Promise.resolve({ currency: "VND", kpis: {} });
    },
  } as unknown as OperationsRepository;

  const app = express();
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
    failure = undefined;
  });

  const get = (path: string, roles: string | undefined, actorType = "employee", scope?: string) =>
    fetch(`${base}${path}`, {
      headers: {
        "X-Actor-Type": actorType,
        ...(roles === undefined ? {} : { "X-Actor-Roles": roles }),
        ...(scope === undefined ? {} : { "X-Actor-Site-Ids": scope }),
      },
    });

  it.each(["Platform Admin", "Pharmacy Manager"])(
    "answers %s with the period and the default channel",
    async (role) => {
      const response = await get(PATH, role);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ currency: "VND" });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.query.from).toStrictEqual(new Date("2026-10-08T00:00:00.000Z"));
      expect(calls[0]?.query.to).toStrictEqual(new Date("2026-10-15T00:00:00.000Z"));
      expect(calls[0]?.query.channel).toBe("all");
      expect(calls[0]?.query.siteId).toBeUndefined();
    },
  );

  it("passes the requested channel and site, inside the caller's scope", async () => {
    const response = await get(`${PATH}&channel=online&siteId=${SITE}`, "Pharmacy Manager", "employee", SITE);
    expect(response.status).toBe(200);
    expect(calls[0]?.query).toMatchObject({ channel: "online", siteId: SITE });
    expect(calls[0]?.siteIds).toStrictEqual([SITE]);
  });

  it("passes the assigned sites of a site-scoped manager when no site is asked for", async () => {
    await get(PATH, "Pharmacy Manager", "employee", `${SITE},${OTHER_SITE}`);
    expect(calls[0]?.siteIds).toStrictEqual([SITE, OTHER_SITE]);
  });

  it.each(["Warehouse Staff", "Pharmacist"])("refuses %s before reading anything", async (role) => {
    const response = await get(PATH, role);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a caller with no employee role header, and a service caller", async () => {
    expect((await get(PATH, undefined)).status).toBe(403);
    expect((await get(PATH, "Platform Admin", "system")).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["no from", "/dashboard/analytics?to=2026-10-15T00:00:00.000Z"],
    ["to not after from", "/dashboard/analytics?from=2026-10-15T00:00:00.000Z&to=2026-10-08T00:00:00.000Z"],
    ["a period over 366 days", "/dashboard/analytics?from=2025-10-13T00:00:00.000Z&to=2026-10-15T00:00:00.000Z"],
    ["a date without a time", "/dashboard/analytics?from=2026-10-08&to=2026-10-15"],
    ["a site id that is not a UUID", `${PATH}&siteId=abc`],
    ["a channel outside all, counter, online", `${PATH}&channel=web`],
  ])("answers 400 for %s before reading anything", async (_label, path) => {
    const response = await get(path, "Pharmacy Manager");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: 400, code: "invalid_request" });
    expect(calls).toHaveLength(0);
  });

  it("answers 422 with the owner's code when payment-service refuses the range as too large", async () => {
    failure = new AnalyticsReadError("/internal/analytics/paid-invoices", 422, "analytics_range_too_large");
    const response = await get(PATH, "Pharmacy Manager");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ status: 422, code: "analytics_range_too_large" });
  });

  it("answers 500 for any other failed read, never a partial figure", async () => {
    failure = new AnalyticsReadError("/internal/analytics/stock-health", 500, undefined);
    const response = await get(PATH, "Pharmacy Manager");
    expect(response.status).toBe(500);
  });
});
