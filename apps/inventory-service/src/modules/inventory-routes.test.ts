import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { InventoryRepository } from "./inventory-repository.ts";
import { createInventoryRouter } from "./inventory-routes.ts";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  productA: "00000000-0000-4000-8000-000000000002",
  productB: "00000000-0000-4000-8000-000000000003",
  batchA: "00000000-0000-4000-8000-000000000004",
  batchB: "00000000-0000-4000-8000-000000000005",
  sourceSite: "00000000-0000-4000-8000-000000000006",
  destinationSite: "00000000-0000-4000-8000-000000000007",
  sourceLocation: "00000000-0000-4000-8000-000000000008",
  destinationLocation: "00000000-0000-4000-8000-000000000009",
  stocktake: "00000000-0000-4000-8000-000000000010",
  adjustment: "00000000-0000-4000-8000-000000000013",
  transfer: "00000000-0000-4000-8000-000000000014",
  replenishment: "00000000-0000-4000-8000-000000000015",
};

const createTestServer = async (repository: InventoryRepository): Promise<{ server: Server; url: string }> => {
  const app = express();
  app.use(express.json());
  app.use(createInventoryRouter(repository));
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
    const repository = { reviewBatch } as unknown as InventoryRepository;
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
      .fn<(id: string, action: "approve" | "ship" | "receive" | "cancel") => Promise<unknown>>()
      .mockResolvedValue({ id: ids.transfer, status: "Received" });
    const postStocktake = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.stocktake, status: "Completed" });
    const transitionReplenishment = vi
      .fn<(id: string, action: "approve" | "reject" | "cancel" | "fulfill") => Promise<unknown>>()
      .mockResolvedValue({ id: ids.replenishment, status: "Fulfilled" });
    const transitionAdjustment = vi
      .fn<(id: string, action: "approve" | "reject", actorId: string, approvalNotes?: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.adjustment, status: "Approved" });
    const repository = {
      transitionTransfer,
      postStocktake,
      transitionReplenishment,
      transitionAdjustment,
    } as unknown as InventoryRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;
    const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
      fetch(`${testServer.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
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
    expect(postStocktake).toHaveBeenCalledWith(ids.stocktake);
    expect(transitionReplenishment).toHaveBeenCalledWith(ids.replenishment, "fulfill");
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
});
