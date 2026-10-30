import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { InventoryRepository } from "./inventory-repository.ts";
import { createInventoryRouter } from "./inventory-routes.ts";
import { encodePageCursor } from "./page-cursor.ts";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000099",
  productA: "00000000-0000-4000-8000-000000000002",
  productB: "00000000-0000-4000-8000-000000000003",
  batchA: "00000000-0000-4000-8000-000000000004",
  batchB: "00000000-0000-4000-8000-000000000005",
  sourceSite: "00000000-0000-4000-8000-000000000006",
  destinationSite: "00000000-0000-4000-8000-000000000007",
  thirdSite: "00000000-0000-4000-8000-000000000016",
  sourceLocation: "00000000-0000-4000-8000-000000000008",
  destinationLocation: "00000000-0000-4000-8000-000000000009",
  stocktake: "00000000-0000-4000-8000-000000000010",
  adjustment: "00000000-0000-4000-8000-000000000013",
  transfer: "00000000-0000-4000-8000-000000000014",
  replenishment: "00000000-0000-4000-8000-000000000015",
};

const createTestServer = async (
  repository: InventoryRepository,
  dispenseCostRowLimit?: number,
): Promise<{ server: Server; url: string }> => {
  const app = express();
  app.use(express.json());
  // The edge forwards the verified roles; a test call without them acts as every staff role at once, which passes every role
  // check. Role and site cases send their own headers.
  app.use((request, _response, next) => {
    if (request.header("x-actor-roles") === undefined)
      request.headers["x-actor-roles"] = "Pharmacist,Pharmacy Manager,Warehouse Staff";
    next();
  });
  app.use(createInventoryRouter(repository, dispenseCostRowLimit));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) =>
    response.status(500).json({ error: String(error) }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
};

describe("inventory stock health route", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
  });

  const period = "from=2026-10-01T00:00:00Z&to=2026-10-28T00:00:00Z";
  const row = {
    siteId: ids.sourceSite,
    productId: ids.productA,
    onHand: 133,
    reserved: 3,
    dispensed: 7,
    netChange: 3,
    lastMovementAt: "2026-10-28T00:00:00.000Z",
    expired: 1,
    expiring30: 10,
    expiring60: 10,
    expiring90: 48,
  };

  it("refuses every caller that is not the system actor, whatever identity it claims", async () => {
    const stockHealth = vi.fn().mockResolvedValue([]);
    const repository = { stockHealth } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const withoutActor = await fetch(`${testServer.url}/internal/analytics/stock-health?${period}`);
    const employee = await fetch(`${testServer.url}/internal/analytics/stock-health?${period}`, {
      headers: { "x-actor-type": "employee", "x-actor-roles": "Platform Admin" },
    });
    const customer = await fetch(`${testServer.url}/internal/analytics/stock-health?${period}`, {
      headers: { "x-actor-type": "customer" },
    });

    expect(withoutActor.status).toBe(403);
    expect(employee.status).toBe(403);
    expect(customer.status).toBe(403);
    expect(stockHealth).not.toHaveBeenCalled();
  });

  it("refuses a missing, non-date-time or inverted period with 400", async () => {
    const stockHealth = vi.fn().mockResolvedValue([]);
    const repository = { stockHealth } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;
    const headers = { "x-actor-type": "system" };

    const missingTo = await fetch(`${testServer.url}/internal/analytics/stock-health?from=2026-10-01T00:00:00Z`, {
      headers,
    });
    const dateOnly = await fetch(`${testServer.url}/internal/analytics/stock-health?from=2026-10-01&to=2026-10-28`, {
      headers,
    });
    const inverted = await fetch(
      `${testServer.url}/internal/analytics/stock-health?from=2026-10-28T00:00:00Z&to=2026-10-01T00:00:00Z`,
      { headers },
    );

    expect(missingTo.status).toBe(400);
    expect(dateOnly.status).toBe(400);
    expect(inverted.status).toBe(400);
    expect(stockHealth).not.toHaveBeenCalled();
  });

  it("answers the period, the as-of instant, the dead stock window and the rows, scoped by the forwarded sites", async () => {
    const stockHealth = vi.fn().mockResolvedValue([row]);
    const repository = { stockHealth } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/internal/analytics/stock-health?${period}`, {
      headers: { "x-actor-type": "system", "x-actor-site-ids": `${ids.sourceSite},${ids.destinationSite}` },
    });
    const body = (await response.json()) as { asOf: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-28T00:00:00.000Z",
      asOf: expect.any(String),
      deadStockDays: 90,
      rows: [row],
    });
    expect(new Date(body.asOf).toISOString()).toBe(body.asOf);
    const [input] = stockHealth.mock.calls[0] ?? [];
    expect(input.from).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(input.to).toEqual(new Date("2026-10-28T00:00:00Z"));
    expect(input.siteIds).toEqual([ids.sourceSite, ids.destinationSite]);
    expect(input.asOf).toEqual(new Date(body.asOf));
  });

  it("reads every site when the system actor forwards no site scope", async () => {
    const stockHealth = vi.fn().mockResolvedValue([]);
    const repository = { stockHealth } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    await fetch(`${testServer.url}/internal/analytics/stock-health?${period}`, {
      headers: { "x-actor-type": "system" },
    });

    expect(stockHealth.mock.calls[0]?.[0]?.siteIds).toBeUndefined();
  });
});

describe("inventory dispense costs route", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
  });

  const since = "since=2026-10-01T00:00:00Z";
  const cost = { referenceType: "Order", referenceId: ids.transfer, quantity: 4, costedQuantity: 4, cost: 700 };

  it("refuses every caller that is not the system actor", async () => {
    const dispenseCosts = vi.fn().mockResolvedValue([]);
    const testServer = await createTestServer({ dispenseCosts } as unknown as InventoryRepository);
    server = testServer.server;

    const anonymous = await fetch(`${testServer.url}/internal/analytics/dispense-costs?${since}`);
    const employee = await fetch(`${testServer.url}/internal/analytics/dispense-costs?${since}`, {
      headers: { "x-actor-type": "employee", "x-actor-roles": "Platform Admin" },
    });

    expect(anonymous.status).toBe(403);
    expect(employee.status).toBe(403);
    expect(dispenseCosts).not.toHaveBeenCalled();
  });

  it("refuses a missing or date-only instant with 400", async () => {
    const dispenseCosts = vi.fn().mockResolvedValue([]);
    const testServer = await createTestServer({ dispenseCosts } as unknown as InventoryRepository);
    server = testServer.server;
    const headers = { "x-actor-type": "system" };

    expect((await fetch(`${testServer.url}/internal/analytics/dispense-costs`, { headers })).status).toBe(400);
    expect(
      (await fetch(`${testServer.url}/internal/analytics/dispense-costs?since=2026-10-01`, { headers })).status,
    ).toBe(400);
    expect(dispenseCosts).not.toHaveBeenCalled();
  });

  it("answers the instant and the rows", async () => {
    const dispenseCosts = vi.fn().mockResolvedValue([cost]);
    const testServer = await createTestServer({ dispenseCosts } as unknown as InventoryRepository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/internal/analytics/dispense-costs?${since}`, {
      headers: { "x-actor-type": "system" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ since: "2026-10-01T00:00:00.000Z", rows: [cost] });
    expect(dispenseCosts.mock.calls[0]?.[0]?.since).toEqual(new Date("2026-10-01T00:00:00Z"));
  });

  it("answers 422 analytics_range_too_large when the read returns more than the cap", async () => {
    const dispenseCosts = vi.fn().mockResolvedValue([cost, { ...cost, referenceId: ids.adjustment }]);
    const testServer = await createTestServer({ dispenseCosts } as unknown as InventoryRepository, 1);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/internal/analytics/dispense-costs?${since}`, {
      headers: { "x-actor-type": "system" },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "analytics_range_too_large" });
  });
});

describe("inventory transfer suggestions route", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
  });

  const positions = [
    {
      productId: ids.productA,
      siteId: ids.sourceSite,
      available: 300,
      dispensedQuantity: 150,
      earliestExpiry: "2099-12-31",
    },
    {
      productId: ids.productA,
      siteId: ids.destinationSite,
      available: 10,
      dispensedQuantity: 60,
      earliestExpiry: null,
    },
    {
      productId: ids.productA,
      siteId: ids.thirdSite,
      available: 10,
      dispensedQuantity: 60,
      earliestExpiry: null,
    },
  ];

  it("refuses a role that may not read transfers", async () => {
    const transferPositions = vi.fn().mockResolvedValue(positions);
    const testServer = await createTestServer({ transferPositions } as unknown as InventoryRepository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/inventory/transfer-suggestions`, {
      headers: { "x-actor-roles": "Pharmacist" },
    });

    expect(response.status).toBe(403);
    expect(transferPositions).not.toHaveBeenCalled();
  });

  it("refuses a window outside the 7 to 180 days the route accepts", async () => {
    const transferPositions = vi.fn().mockResolvedValue(positions);
    const testServer = await createTestServer({ transferPositions } as unknown as InventoryRepository);
    server = testServer.server;

    const tooShort = await fetch(`${testServer.url}/inventory/transfer-suggestions?windowDays=3`);
    const notANumber = await fetch(`${testServer.url}/inventory/transfer-suggestions?windowDays=abc`);

    expect(tooShort.status).toBe(400);
    expect(notANumber.status).toBe(400);
    expect(transferPositions).not.toHaveBeenCalled();
  });

  it("answers the suggestions for the sites in scope, with the formulas it applied", async () => {
    const transferPositions = vi.fn().mockResolvedValue(positions);
    const testServer = await createTestServer({ transferPositions } as unknown as InventoryRepository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/inventory/transfer-suggestions?windowDays=30`, {
      headers: { "x-actor-site-ids": `${ids.sourceSite},${ids.destinationSite},${ids.thirdSite}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      generatedAt: string;
      windowDays: number;
      params: Record<string, number>;
      suggestions: Array<Record<string, unknown>>;
    };
    expect(body).toMatchObject({
      windowDays: 30,
      params: { keepCoverDays: 45, triggerCoverDays: 14, targetCoverDays: 30 },
    });
    expect(new Date(body.generatedAt).toISOString()).toBe(body.generatedAt);
    expect(body.suggestions).toHaveLength(2);
    expect(body.suggestions[0]).toMatchObject({
      productId: ids.productA,
      sourceSiteId: ids.sourceSite,
      quantity: 50,
      sourceAvailable: 300,
      sourceDaysOfCover: 60,
      destinationAvailable: 10,
      destinationDaysOfCover: 5,
      destinationDailyVelocity: 2,
      cappedByExpiry: false,
    });
    const [input] = transferPositions.mock.calls[0] ?? [];
    expect(input.siteIds).toEqual([ids.sourceSite, ids.destinationSite, ids.thirdSite]);
    expect(Math.round((Date.now() - input.windowStart.getTime()) / (24 * 60 * 60 * 1000))).toBe(30);
    expect(input.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("filters the answer to one destination site", async () => {
    const transferPositions = vi.fn().mockResolvedValue(positions);
    const testServer = await createTestServer({ transferPositions } as unknown as InventoryRepository);
    server = testServer.server;

    const response = await fetch(
      `${testServer.url}/inventory/transfer-suggestions?destinationSiteId=${ids.destinationSite}`,
    );
    const body = (await response.json()) as { suggestions: Array<Record<string, unknown>> };

    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]?.destinationSiteId).toBe(ids.destinationSite);
    expect(transferPositions.mock.calls[0]?.[0]?.siteIds).toBeUndefined();
  });
});

describe("inventory API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
  });

  it("creates a transfer with notes and locations", async () => {
    const createTransfer = vi
      .fn<(input: Parameters<InventoryRepository["createTransfer"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.transfer, status: "PendingApproval" });
    const repository = { createTransfer } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/inventory/transfers`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        transferNumber: "TR-API-001",
        sourceSiteId: ids.sourceSite,
        destinationSiteId: ids.destinationSite,
        lines: [
          {
            productId: ids.productA,
            productBatchId: ids.batchA,
            sourceStorageLocationId: ids.sourceLocation,
            destinationStorageLocationId: ids.destinationLocation,
            quantity: 3,
            notes: "Line note",
          },
        ],
      }),
    });

    expect(response.status).toBe(201);
    const input = createTransfer.mock.calls[0]?.[0];
    expect(input?.transferNumber).toBe("TR-API-001");
    expect(input?.lines[0]?.sourceStorageLocationId).toBe(ids.sourceLocation);
    expect(input?.lines[0]?.destinationStorageLocationId).toBe(ids.destinationLocation);
    expect(input?.lines[0]?.quantity).toBe(3);
    expect(input?.lines[0]?.notes).toBe("Line note");
  });

  it("accepts a transfer with multiple lines and preserves the actor", async () => {
    const createTransfer = vi
      .fn<(input: Parameters<InventoryRepository["createTransfer"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000014", status: "Pending" });
    const repository = { createTransfer } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/inventory/transfers`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        transferNumber: "TR-API-001",
        sourceSiteId: ids.sourceSite,
        destinationSiteId: ids.destinationSite,
        lines: [
          {
            productId: ids.productA,
            productBatchId: ids.batchA,
            sourceStorageLocationId: ids.sourceLocation,
            destinationStorageLocationId: ids.destinationLocation,
            quantity: 3,
          },
          {
            productId: ids.productB,
            productBatchId: ids.batchB,
            sourceStorageLocationId: ids.sourceLocation,
            destinationStorageLocationId: ids.destinationLocation,
            quantity: 5,
          },
        ],
      }),
    });

    expect(response.status).toBe(201);
    const transferInput = createTransfer.mock.calls[0]?.[0];
    expect(transferInput?.createdBy).toBe(ids.actor);
    expect(transferInput?.lines.map((line) => line.productId)).toEqual([ids.productA, ids.productB]);
  });

  it("creates a stocktake session", async () => {
    const createStocktake = vi
      .fn<(input: Parameters<InventoryRepository["createStocktake"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.stocktake, status: "Pending" });
    const repository = { createStocktake } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const createResponse = await fetch(`${testServer.url}/inventory/stocktakes`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        siteId: ids.sourceSite,
        storageLocationId: ids.sourceLocation,
        notes: "Stocktake note",
        lines: [{ productBatchId: ids.batchA }],
      }),
    });

    expect(createResponse.status).toBe(201);
    expect(createStocktake.mock.calls[0]?.[0].notes).toBe("Stocktake note");
  });

  it("accepts multiple stocktake and return lines", async () => {
    const createStocktake = vi
      .fn<(input: Parameters<InventoryRepository["createStocktake"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.stocktake, status: "Pending" });
    const createReturn = vi
      .fn<(input: Parameters<InventoryRepository["createReturn"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000015", status: "Completed" });
    const repository = { createStocktake, createReturn } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const stocktakeResponse = await fetch(`${testServer.url}/inventory/stocktakes`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        siteId: ids.sourceSite,
        storageLocationId: ids.sourceLocation,
        lines: [{ productBatchId: ids.batchA }, { productBatchId: ids.batchB }],
      }),
    });
    const returnResponse = await fetch(`${testServer.url}/inventory/returns`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        siteId: ids.sourceSite,
        reason: "API test",
        lines: [
          { productBatchId: ids.batchA, storageLocationId: ids.sourceLocation, quantity: 1 },
          { productBatchId: ids.batchB, storageLocationId: ids.sourceLocation, quantity: 2 },
        ],
      }),
    });

    expect(stocktakeResponse.status).toBe(201);
    expect(returnResponse.status).toBe(201);
    const stocktakeInput = createStocktake.mock.calls[0]?.[0];
    const returnInput = createReturn.mock.calls[0]?.[0];
    expect(stocktakeInput?.lines?.map((line) => line.productBatchId)).toEqual([ids.batchA, ids.batchB]);
    expect(returnInput?.lines.map((line) => line.productBatchId)).toEqual([ids.batchA, ids.batchB]);
  });

  it("accepts a multi-line replenishment request and preserves actor data", async () => {
    const createReplenishment = vi
      .fn<(input: Parameters<InventoryRepository["createReplenishment"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.replenishment, status: "Pending" });
    const repository = { createReplenishment } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/inventory/replenishment`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        siteId: ids.sourceSite,
        storageLocationId: ids.sourceLocation,
        notes: "API test",
        lines: [
          { productId: ids.productA, productBatchId: ids.batchA, requestedQuantity: 2 },
          { productId: ids.productB, productBatchId: ids.batchB, requestedQuantity: 4 },
        ],
      }),
    });

    expect(response.status).toBe(201);
    const input = createReplenishment.mock.calls[0]?.[0];
    expect(input?.requestedBy).toBe(ids.actor);
    expect(input?.lines.map((line) => line.productId)).toEqual([ids.productA, ids.productB]);
  });

  it("reviews batch quality", async () => {
    const reviewBatch = vi
      .fn<(id: string, status: "Released" | "Rejected", notes?: string | null, actorId?: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.batchA, qualityStatus: "Released" });
    const repository = {
      reviewBatch,
      getBatch: vi.fn().mockResolvedValue({ id: ids.batchA, createdBy: ids.other }),
      batchSiteIds: vi.fn().mockResolvedValue([ids.sourceSite]),
    } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const qualityResponse = await fetch(`${testServer.url}/inventory/batches/${ids.batchA}/quality`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({ decision: "release", notes: "Reviewed" }),
    });

    expect(qualityResponse.status).toBe(200);
    expect(reviewBatch).toHaveBeenCalledWith(ids.batchA, "Released", "Reviewed", ids.actor);
  });

  it("forwards critical inventory lifecycle transitions", async () => {
    const transitionTransfer = vi
      .fn<(id: string, action: "approve" | "ship" | "receive" | "cancel", actorId: string | null) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.transfer, status: "Received" });
    const postStocktake = vi
      .fn<(id: string, actorId: string | null) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.stocktake, status: "Completed" });
    const transitionReplenishment = vi
      .fn<(id: string, action: "approve" | "reject" | "cancel" | "fulfill", reviewedBy?: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.replenishment, status: "Fulfilled" });
    const transitionAdjustment = vi
      .fn<(id: string, action: "approve" | "reject", actorId: string, approvalNotes?: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.adjustment, status: "Approved" });
    const repository = {
      transitionTransfer,
      postStocktake,
      transitionReplenishment,
      transitionAdjustment,
      getTransfer: vi.fn().mockResolvedValue({
        id: ids.transfer,
        sourceSiteId: ids.sourceSite,
        destinationSiteId: ids.destinationSite,
        createdBy: ids.other,
      }),
      getStocktake: vi.fn().mockResolvedValue({ id: ids.stocktake, siteId: ids.sourceSite, lines: [] }),
      getReplenishment: vi.fn().mockResolvedValue({
        id: ids.replenishment,
        siteId: ids.sourceSite,
        requestedBy: ids.other,
      }),
      getAdjustment: vi.fn().mockResolvedValue({
        id: ids.adjustment,
        siteId: ids.sourceSite,
        createdBy: ids.other,
      }),
    } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;
    const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
      fetch(`${testServer.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Actor-Id": ids.actor, ...headers },
        body: JSON.stringify(body),
      });

    expect((await post(`/inventory/transfers/${ids.transfer}/ship`)).status).toBe(200);
    expect((await post(`/inventory/transfers/${ids.transfer}/receive`)).status).toBe(200);
    expect((await post(`/inventory/stocktakes/${ids.stocktake}/post`)).status).toBe(200);
    expect((await post(`/inventory/replenishment/${ids.replenishment}/fulfill`)).status).toBe(200);
    expect(
      (
        await post(
          `/inventory/adjustments/${ids.adjustment}/approve`,
          { approvalNotes: "Reviewed" },
          { "X-Actor-Id": ids.actor },
        )
      ).status,
    ).toBe(200);

    expect(transitionTransfer.mock.calls.map((call) => call[1])).toEqual(["ship", "receive"]);
    expect(postStocktake).toHaveBeenCalledWith(ids.stocktake, ids.actor);
    expect(transitionReplenishment).toHaveBeenCalledWith(ids.replenishment, "fulfill", ids.actor, null);
    expect(transitionAdjustment).toHaveBeenCalledWith(ids.adjustment, "approve", ids.actor, "Reviewed");
  });

  it("requires a valid adjustment before calling the repository", async () => {
    const createAdjustment = vi
      .fn<(input: Parameters<InventoryRepository["createAdjustment"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.adjustment, status: "Pending" });
    const repository = { createAdjustment } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const invalidResponse = await fetch(`${testServer.url}/inventory/adjustments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId: ids.productA, quantity: 1 }),
    });
    const validResponse = await fetch(`${testServer.url}/inventory/adjustments`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        productId: ids.productA,
        productBatchId: ids.batchA,
        siteId: ids.sourceSite,
        storageLocationId: ids.sourceLocation,
        adjustmentType: "Positive",
        quantity: 2,
        reason: "API test",
      }),
    });

    expect(invalidResponse.status).toBe(400);
    expect(validResponse.status).toBe(201);
    const adjustmentInput = createAdjustment.mock.calls[0]?.[0];
    expect(adjustmentInput?.createdBy).toBe(ids.actor);
    expect(adjustmentInput?.quantity).toBe(2);
  });

  it("sends the next-page cursor in a header only while another page follows, and reads the cursor back", async () => {
    const nextCursor = encodePageCursor({ sortValue: "2026-03-01T10:00:00.000000Z", id: ids.transfer });
    const listTransfers = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: ids.transfer }], nextCursor })
      .mockResolvedValueOnce({ rows: [], nextCursor: undefined });
    const repository = { listTransfers } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const first = await fetch(`${testServer.url}/inventory/transfers?limit=1&status=Approved&q=TR-1`);
    const second = await fetch(`${testServer.url}/inventory/transfers?limit=1&cursor=${nextCursor}`);

    expect(first.status).toBe(200);
    expect(first.headers.get("x-next-cursor")).toBe(nextCursor);
    expect(await first.json()).toEqual([{ id: ids.transfer }]);
    const [firstFilters, firstPage] = listTransfers.mock.calls[0] ?? [];
    expect(firstFilters).toMatchObject({ statuses: ["Approved"], q: "TR-1" });
    expect(firstPage).toEqual({ limit: 1, cursor: undefined });

    expect(second.headers.get("x-next-cursor")).toBeNull();
    expect(await second.json()).toEqual([]);
    expect(listTransfers.mock.calls[1]?.[1]).toEqual({
      limit: 1,
      cursor: { sortValue: "2026-03-01T10:00:00.000000Z", id: ids.transfer },
    });
  });

  it("refuses a tampered cursor with invalid_cursor before the repository is asked", async () => {
    const listTransfers = vi.fn();
    const repository = { listTransfers } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/inventory/transfers?cursor=not-a-cursor`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_cursor" });
    expect(listTransfers).not.toHaveBeenCalled();
  });

  it("counts transfers, adjustments and stocktakes with comma-separated statuses and exclusions", async () => {
    const countTransfers = vi.fn().mockResolvedValue(4);
    const countAdjustments = vi.fn().mockResolvedValue(2);
    const countStocktakes = vi.fn().mockResolvedValue(7);
    const repository = { countTransfers, countAdjustments, countStocktakes } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const transfers = await fetch(
      `${testServer.url}/inventory/transfers/count?status=PendingApproval,Draft,Approved,InTransit`,
    );
    const adjustments = await fetch(`${testServer.url}/inventory/adjustments/count?status=Pending`);
    const stocktakes = await fetch(`${testServer.url}/inventory/stocktakes/count?excludeStatus=Completed,Cancelled`);

    expect(await transfers.json()).toEqual({ count: 4 });
    expect(await adjustments.json()).toEqual({ count: 2 });
    expect(await stocktakes.json()).toEqual({ count: 7 });
    expect(countTransfers.mock.calls[0]?.[0]).toMatchObject({
      statuses: ["PendingApproval", "Draft", "Approved", "InTransit"],
    });
    expect(countAdjustments.mock.calls[0]?.[0]).toMatchObject({ statuses: ["Pending"] });
    expect(countStocktakes.mock.calls[0]?.[0]).toMatchObject({ excludeStatuses: ["Completed", "Cancelled"] });
  });

  it("refuses a movement window that is not a timestamp and bounds the ledger by it when valid", async () => {
    const listMovements = vi.fn().mockResolvedValue({ rows: [], nextCursor: undefined });
    const repository = { listMovements } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const invalid = await fetch(`${testServer.url}/inventory/movements?from=yesterday`);
    const valid = await fetch(
      `${testServer.url}/inventory/movements?from=2026-03-01T00:00:00Z&to=2026-03-31T23:59:59Z&productId=${ids.productA}`,
    );

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    const [filters, page] = listMovements.mock.calls[0] ?? [];
    expect(filters.from).toEqual(new Date("2026-03-01T00:00:00Z"));
    expect(filters.to).toEqual(new Date("2026-03-31T23:59:59Z"));
    expect(filters.productId).toBe(ids.productA);
    expect(page).toEqual({ limit: 500, cursor: undefined });
  });

  it("answers every return and every balance when neither limit nor cursor is sent", async () => {
    const listReturns = vi.fn().mockResolvedValue({ rows: [{ id: ids.transfer }], nextCursor: undefined });
    const listBalances = vi.fn().mockResolvedValue({ rows: [], nextCursor: undefined });
    const repository = { listReturns, listBalances } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const returns = await fetch(`${testServer.url}/inventory/returns`);
    const balances = await fetch(`${testServer.url}/inventory/balances?limit=2&q=LOT&includeZeroBalances=false`);

    expect(await returns.json()).toEqual([{ id: ids.transfer }]);
    expect(listReturns.mock.calls[0]?.[1]).toEqual({ limit: undefined, cursor: undefined });
    expect(balances.status).toBe(200);
    const [balanceFilters, balancePage] = listBalances.mock.calls[0] ?? [];
    expect(balanceFilters).toMatchObject({ q: "LOT", includeZeroBalances: false });
    expect(balancePage).toEqual({ limit: 2, cursor: undefined });
  });
});
