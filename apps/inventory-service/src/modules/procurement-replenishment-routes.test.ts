import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProcurementRepository } from "./procurement-repository.ts";
import { createProcurementRouter } from "./procurement-routes.ts";

import { bearerHeaders } from "../test-support/access-tokens.ts";

const httpFetch = globalThis.fetch.bind(globalThis);

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  supplier: "00000000-0000-4000-8000-000000000002",
  site: "00000000-0000-4000-8000-000000000003",
  productA: "00000000-0000-4000-8000-000000000005",
  productB: "00000000-0000-4000-8000-000000000006",
  otherSupplier: "00000000-0000-4000-8000-000000000098",
  otherSite: "00000000-0000-4000-8000-000000000099",
};

const caller = await bearerHeaders({ actorType: "employee", actorId: ids.actor });

const DAY = 24 * 60 * 60 * 1000;
const suggestionsPath = "/procurement/replenishment-suggestions";
const draftsPath = "/procurement/replenishment-suggestions/draft-orders";
const manager = { "x-actor-roles": "Pharmacy Manager", "x-actor-site-ids": ids.site };

type SuggestionInput = { siteId: string; windowStart: Date; now: Date };
type DraftOrdersInput = Array<{
  supplierId: string;
  siteId: string;
  createdBy: string;
  notes?: string | null | undefined;
  lines: Array<{ productId: string; orderedQuantity: number }>;
}>;

const validDrafts = {
  siteId: ids.site,
  orders: [
    { supplierId: ids.supplier, lines: [{ productId: ids.productA, orderedQuantity: 10 }] },
    { supplierId: ids.otherSupplier, lines: [{ productId: ids.productB, orderedQuantity: 3 }] },
  ],
};

const startServer = async (repository: ProcurementRepository): Promise<{ server: Server; url: string }> => {
  // The catalog reference check reads the shared internal secret and forwards the caller's Authorization to the catalog.
  vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
  const app = express();
  app.use(express.json());
  // The edge forwards the verified roles; a call without them acts as Platform Admin, which passes every role check.
  app.use((request, _response, next) => {
    if (request.header("x-actor-roles") === undefined) request.headers["x-actor-roles"] = "Platform Admin";
    request.headers["x-actor-id"] ??= ids.actor;
    next();
  });
  app.use(createProcurementRouter(repository, { catalogServiceUrl: "http://catalog.test" }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) =>
    response.status(500).json({ error: String(error) }),
  );
  const server = createServer(app);
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const closeServer = async (server: Server): Promise<void> => {
  const closed = Promise.withResolvers<void>();
  server.close((error) => (error ? closed.reject(error) : closed.resolve()));
  await closed.promise;
};

const getSuggestions = (url: string, query: string, headers: Record<string, string> = {}) =>
  httpFetch(`${url}${suggestionsPath}?${query}`, { headers: { "X-Actor-Id": ids.actor, ...caller, ...headers } });

const postDrafts = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  httpFetch(`${url}${draftsPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Actor-Id": ids.actor, ...caller, ...headers },
    body: JSON.stringify(body),
  });

describe("replenishment suggestions API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const suggestionInputs = () => {
    const replenishmentInputs = vi.fn<(input: SuggestionInput) => Promise<unknown>>().mockResolvedValue({
      positions: [
        {
          productId: ids.productA,
          onHand: 4,
          reserved: 0,
          dispensedQuantity: 0,
          inboundQuantity: 0,
          supplierId: ids.supplier,
        },
        {
          productId: ids.productB,
          onHand: 500,
          reserved: 0,
          dispensedQuantity: 0,
          inboundQuantity: 0,
          supplierId: ids.supplier,
        },
      ],
      leadTimeSamples: [],
    });
    return { repository: { replenishmentInputs } as unknown as ProcurementRepository, replenishmentInputs };
  };

  const draftOrders = () => {
    const createPurchaseOrders = vi
      .fn<(orders: DraftOrdersInput) => Promise<unknown>>()
      .mockImplementation(async (orders: DraftOrdersInput) =>
        orders.map((order, index) => ({
          id: `00000000-0000-4000-8000-00000000010${index}`,
          supplierId: order.supplierId,
          status: "Draft",
          lines: [],
        })),
      );
    return { repository: { createPurchaseOrders } as unknown as ProcurementRepository, createPurchaseOrders };
  };

  describe("GET /procurement/replenishment-suggestions", () => {
    it("refuses Pharmacist and Warehouse Staff, and admits Pharmacy Manager and Platform Admin", async () => {
      const { repository } = suggestionInputs();
      const started = await startServer(repository);
      server = started.server;
      const query = `siteId=${ids.site}`;

      expect((await getSuggestions(started.url, query, { "x-actor-roles": "Pharmacist" })).status).toBe(403);
      expect((await getSuggestions(started.url, query, { "x-actor-roles": "Warehouse Staff" })).status).toBe(403);
      expect((await getSuggestions(started.url, query, manager)).status).toBe(200);
      expect((await getSuggestions(started.url, query, { "x-actor-roles": "Platform Admin" })).status).toBe(200);
    });

    it("refuses a site outside the manager's scope before reading", async () => {
      const { repository, replenishmentInputs } = suggestionInputs();
      const started = await startServer(repository);
      server = started.server;

      const response = await getSuggestions(started.url, `siteId=${ids.otherSite}`, {
        "x-actor-roles": "Pharmacy Manager",
        "x-actor-site-ids": ids.site,
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "site_access_denied" });
      expect(replenishmentInputs).not.toHaveBeenCalled();
    });

    it("requires a site and answers 400 for out-of-range or malformed parameters", async () => {
      const { repository, replenishmentInputs } = suggestionInputs();
      const started = await startServer(repository);
      server = started.server;
      const invalidQueries = [
        "",
        "siteId=not-a-uuid",
        `siteId=${ids.site}&windowDays=6`,
        `siteId=${ids.site}&windowDays=181`,
        `siteId=${ids.site}&windowDays=abc`,
        `siteId=${ids.site}&coverDays=0`,
        `siteId=${ids.site}&coverDays=91`,
        `siteId=${ids.site}&safetyDays=-1`,
        `siteId=${ids.site}&safetyDays=61`,
        `siteId=${ids.site}&defaultLeadTimeDays=0`,
        `siteId=${ids.site}&defaultLeadTimeDays=91`,
        `siteId=${ids.site}&windowDays=7&windowDays=8`,
        `siteId=${ids.site}&windowDays=7.5`,
      ];

      for (const query of invalidQueries) {
        const response = await getSuggestions(started.url, query, manager);
        expect(response.status, query).toBe(400);
        expect(await response.json()).toMatchObject({ code: "invalid_request" });
      }
      expect(replenishmentInputs).not.toHaveBeenCalled();
    });

    it("answers the design's shape with the defaults echoed and only the suggested products", async () => {
      const { repository } = suggestionInputs();
      const started = await startServer(repository);
      server = started.server;

      const response = await getSuggestions(started.url, `siteId=${ids.site}`, manager);
      const body = (await response.json()) as {
        siteId: string;
        params: Record<string, number>;
        generatedAt: string;
        suggestions: Array<Record<string, unknown>>;
      };

      expect(response.status).toBe(200);
      expect(body.siteId).toBe(ids.site);
      expect(body.params).toEqual({ windowDays: 30, coverDays: 14, safetyDays: 7, defaultLeadTimeDays: 7 });
      expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
      expect(body.suggestions).toEqual([
        expect.objectContaining({
          productId: ids.productA,
          supplierId: ids.supplier,
          dailyVelocity: 0,
          available: 4,
          minimumStock: 10,
          leadTimeDays: 7,
          leadTimeSource: "default",
          sampleCount: 0,
          reorderPoint: 10,
          targetStock: 10,
          suggestedQuantity: 6,
          daysOfCover: null,
        }),
      ]);
    });

    it("reads a window that starts windowDays before now, for the site asked", async () => {
      const { repository, replenishmentInputs } = suggestionInputs();
      const started = await startServer(repository);
      server = started.server;

      await getSuggestions(started.url, `siteId=${ids.site}&windowDays=7`, manager);

      const input = replenishmentInputs.mock.calls[0]?.[0];
      expect(input?.siteId).toBe(ids.site);
      expect((input?.now.getTime() ?? 0) - (input?.windowStart.getTime() ?? 0)).toBe(7 * DAY);
    });
  });

  describe("POST /procurement/replenishment-suggestions/draft-orders", () => {
    it("refuses Pharmacist and Warehouse Staff before any catalog lookup or write", async () => {
      const { repository, createPurchaseOrders } = draftOrders();
      const catalog = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", catalog);
      const started = await startServer(repository);
      server = started.server;

      for (const role of ["Pharmacist", "Warehouse Staff"]) {
        const response = await postDrafts(started.url, validDrafts, { "x-actor-roles": role });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "role_forbidden" });
      }
      expect(catalog).not.toHaveBeenCalled();
      expect(createPurchaseOrders).not.toHaveBeenCalled();
    });

    it("refuses a site outside the manager's scope", async () => {
      const { repository, createPurchaseOrders } = draftOrders();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      const started = await startServer(repository);
      server = started.server;

      const response = await postDrafts(
        started.url,
        { ...validDrafts, siteId: ids.otherSite },
        { "x-actor-roles": "Pharmacy Manager", "x-actor-site-ids": ids.site },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "site_access_denied" });
      expect(createPurchaseOrders).not.toHaveBeenCalled();
    });

    it("refuses a repeated supplier and a repeated product within an order with 400", async () => {
      const { repository, createPurchaseOrders } = draftOrders();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      const started = await startServer(repository);
      server = started.server;
      const line = { productId: ids.productA, orderedQuantity: 1 };
      const bodies = [
        {
          siteId: ids.site,
          orders: [
            { supplierId: ids.supplier, lines: [line] },
            { supplierId: ids.supplier, lines: [{ ...line, productId: ids.productB }] },
          ],
        },
        {
          siteId: ids.site,
          orders: [{ supplierId: ids.supplier, lines: [line, { productId: ids.productA, orderedQuantity: 2 }] }],
        },
      ];

      for (const body of bodies) {
        const response = await postDrafts(started.url, body, manager);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "invalid_request" });
      }
      expect(createPurchaseOrders).not.toHaveBeenCalled();
    });

    it("refuses malformed bodies with 400: whole positive quantities, non-empty and bounded lists", async () => {
      const { repository, createPurchaseOrders } = draftOrders();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      const started = await startServer(repository);
      server = started.server;
      const order = (lines: unknown[]) => ({ supplierId: ids.supplier, lines });
      const fiftyOne = Array.from({ length: 51 }, (_, index) => ({
        supplierId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        lines: [{ productId: ids.productA, orderedQuantity: 1 }],
      }));
      const bodies = [
        { ...validDrafts, orders: [] },
        { ...validDrafts, orders: fiftyOne },
        { ...validDrafts, orders: [order([])] },
        { ...validDrafts, orders: [order([{ productId: ids.productA, orderedQuantity: 0 }])] },
        { ...validDrafts, orders: [order([{ productId: ids.productA, orderedQuantity: 1.5 }])] },
        { ...validDrafts, orders: [order([{ productId: "not-a-uuid", orderedQuantity: 1 }])] },
        {
          ...validDrafts,
          orders: [{ supplierId: "not-a-uuid", lines: [{ productId: ids.productA, orderedQuantity: 1 }] }],
        },
        { orders: validDrafts.orders },
        { siteId: "not-a-uuid", orders: validDrafts.orders },
      ];

      for (const body of bodies) {
        const response = await postDrafts(started.url, body, manager);
        expect(response.status).toBe(400);
      }
      expect(createPurchaseOrders).not.toHaveBeenCalled();
    });

    it("creates every Draft order in one batch, with the default note where none is written", async () => {
      const { repository, createPurchaseOrders } = draftOrders();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      const started = await startServer(repository);
      server = started.server;

      const response = await postDrafts(
        started.url,
        {
          siteId: ids.site,
          orders: [
            { supplierId: ids.supplier, lines: [{ productId: ids.productA, orderedQuantity: 10 }], notes: "Gấp" },
            { supplierId: ids.otherSupplier, lines: [{ productId: ids.productB, orderedQuantity: 3 }] },
          ],
        },
        manager,
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as { purchaseOrders: Array<{ supplierId: string; status: string }> };
      expect(body.purchaseOrders.map((order) => [order.supplierId, order.status])).toEqual([
        [ids.supplier, "Draft"],
        [ids.otherSupplier, "Draft"],
      ]);
      const input = createPurchaseOrders.mock.calls[0]?.[0];
      expect(input?.map((order) => [order.siteId, order.createdBy, order.notes])).toEqual([
        [ids.site, ids.actor, "Gấp"],
        [ids.site, ids.actor, expect.stringContaining("gợi ý bổ sung hàng")],
      ]);
      expect(input?.[1]?.lines).toEqual([{ productId: ids.productB, orderedQuantity: 3 }]);
    });

    it("checks each supplier, the site and each product once in the catalog", async () => {
      const { repository } = draftOrders();
      const catalog = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", catalog);
      const started = await startServer(repository);
      server = started.server;

      const response = await postDrafts(started.url, validDrafts, manager);

      expect(response.status).toBe(201);
      const paths = catalog.mock.calls.map(([target]) => String(target).replace("http://catalog.test", ""));
      expect(paths.sort()).toEqual(
        [
          `/suppliers/${ids.supplier}`,
          `/suppliers/${ids.otherSupplier}`,
          `/sites/${ids.site}`,
          `/products/${ids.productA}`,
          `/products/${ids.productB}`,
        ].sort(),
      );
    });

    it("writes nothing when a catalog reference fails", async () => {
      const { repository, createPurchaseOrders } = draftOrders();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (target: string) => ({ ok: !String(target).endsWith(`/products/${ids.productB}`) })),
      );
      const started = await startServer(repository);
      server = started.server;

      const response = await postDrafts(started.url, validDrafts, manager);

      expect(response.status).toBe(500);
      expect(createPurchaseOrders).not.toHaveBeenCalled();
    });
  });
});
