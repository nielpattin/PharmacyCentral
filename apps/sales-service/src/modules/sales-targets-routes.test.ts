import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTrustedRequestMiddleware } from "../middleware/trusted-request.ts";
import { accessToken, testAccessTokenVerifier } from "../test-access-tokens.ts";
import type { SalesRepository } from "./sales-repository.ts";
import { createSalesRouter } from "./sales-routes.ts";

const serviceSecret = "test-service-secret-1234567890123456";
const actor = "00000000-0000-4000-8000-0000000000a1";
const site = "00000000-0000-4000-8000-0000000000b1";
const otherSite = "00000000-0000-4000-8000-0000000000b2";

const context = (roles: string[], siteIds: string[]): Promise<string> =>
  accessToken({ actorId: actor, actorType: "employee", roles, siteIds });

describe("sales targets API", () => {
  let server: Server | undefined;
  let url: string;
  const setSalesTarget = vi.fn();
  const listSalesTargets = vi.fn();

  beforeEach(async () => {
    setSalesTarget.mockReset();
    listSalesTargets.mockReset();
    setSalesTarget.mockImplementation(async (input: Record<string, unknown>) => ({
      siteId: input.siteId,
      month: input.month,
      amount: input.amount,
      currency: "VND",
    }));
    listSalesTargets.mockResolvedValue([{ siteId: site, month: "2026-10", amount: 1_000_000, currency: "VND" }]);
    const app = express();
    app.use(express.json());
    app.use(createTrustedRequestMiddleware({ verifier: testAccessTokenVerifier, serviceSecret }));
    app.use(
      createSalesRouter({ setSalesTarget, listSalesTargets } as unknown as SalesRepository, {
        catalogServiceUrl: "http://catalog.test",
        inventoryServiceUrl: "http://inventory.test",
        identityServiceUrl: "http://identity.test",
      }),
    );
    server = createServer(app);
    const listening = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", () => listening.resolve());
    await listening.promise;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      const closed = Promise.withResolvers<void>();
      server.close((error) => (error ? closed.reject(error) : closed.resolve()));
      await closed.promise;
    }
    server = undefined;
  });

  const put = async (identity: Promise<string>, body: unknown, path = "/sales-targets") =>
    fetch(`${url}${path}`, {
      method: "PUT",
      headers: { authorization: await identity, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("lets a Pharmacy Manager set a target of one of their sites", async () => {
    const response = await put(context(["Pharmacy Manager"], [site]), {
      siteId: site,
      month: "2026-10",
      amount: 2_500_000,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ siteId: site, month: "2026-10", amount: 2_500_000, currency: "VND" });
    expect(setSalesTarget).toHaveBeenCalledWith({ siteId: site, month: "2026-10", amount: 2_500_000, actorId: actor });
  });

  it("refuses a site outside the manager's scope and a month that is not real", async () => {
    const outside = await put(context(["Pharmacy Manager"], [site]), {
      siteId: otherSite,
      month: "2026-10",
      amount: 1_000_000,
    });
    expect(outside.status).toBe(403);

    const badMonth = await put(context(["Pharmacy Manager"], [site]), {
      siteId: site,
      month: "2026-13",
      amount: 1_000_000,
    });
    expect(badMonth.status).toBe(400);

    const badAmount = await put(context(["Pharmacy Manager"], [site]), {
      siteId: site,
      month: "2026-10",
      amount: 0,
    });
    expect(badAmount.status).toBe(400);
    expect(setSalesTarget).not.toHaveBeenCalled();
  });

  it("refuses a Pharmacist and Platform Admin the write, which only a Pharmacy Manager makes", async () => {
    for (const roles of [["Pharmacist"], ["Platform Admin"]]) {
      const response = await put(context(roles, [site]), { siteId: site, month: "2026-10", amount: 1_000_000 });
      expect(response.status, roles.join(",")).toBe(403);
    }
    expect(setSalesTarget).not.toHaveBeenCalled();
  });

  it("answers the month's targets to operations-query under the service secret", async () => {
    const response = await fetch(`${url}/internal/analytics/sales-targets?month=2026-10`, {
      headers: { "x-internal-service-secret": serviceSecret, "x-actor-site-ids": site },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      targets: [{ siteId: site, month: "2026-10", amount: 1_000_000, currency: "VND" }],
    });
    expect(listSalesTargets).toHaveBeenCalledWith({ month: "2026-10", siteIds: [site] });
  });

  it("keeps the internal read away from a caller without the service secret", async () => {
    const response = await fetch(`${url}/internal/analytics/sales-targets?month=2026-10`);
    expect(response.status).toBe(401);
    expect(listSalesTargets).not.toHaveBeenCalled();
  });
});
