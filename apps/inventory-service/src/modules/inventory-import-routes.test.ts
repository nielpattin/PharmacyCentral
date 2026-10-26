import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createInventoryImportRouter } from "./inventory-import-routes.ts";
import type { InventoryImportService } from "./inventory-import-service.ts";

const createTestServer = async (importService: InventoryImportService | undefined) => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  // The edge forwards the verified roles; a call without them acts as Platform Admin, which passes every role check.
  app.use((request, _response, next) => {
    if (request.header("x-actor-roles") === undefined) request.headers["x-actor-roles"] = "Platform Admin";
    next();
  });
  app.use(createInventoryImportRouter(importService));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

describe("inventory opening balance import API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server)
      await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
    server = undefined;
  });

  it("imports opening balances and returns the summary", async () => {
    const importOpeningBalances = vi.fn().mockResolvedValue({
      created: 1,
      unchanged: 0,
      batchesCreated: 1,
      balances: [
        {
          productId: "00000000-0000-4000-8000-000000000002",
          siteId: "00000000-0000-4000-8000-000000000003",
          storageLocationId: "00000000-0000-4000-8000-000000000004",
          batchNumber: "LOT-1",
          quantity: 100,
        },
      ],
    });
    const testServer = await createTestServer({
      importOpeningBalances,
    } as unknown as InventoryImportService);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/inventory/imports/opening-balances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        balances: [
          {
            productSku: "THU-0001",
            siteCode: "SITE-WH",
            storageLocationCode: "WH-A",
            batchNumber: "LOT-1",
            quantityOnHand: 100,
            expiryDate: "2028-01-05",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "imported", summary: { created: 1, batchesCreated: 1 } });
    expect(importOpeningBalances).toHaveBeenCalledWith(
      expect.objectContaining({
        balances: [expect.objectContaining({ productSku: "THU-0001", qualityStatus: "Released" })],
      }),
      expect.objectContaining({ actorId: null, allowedSiteIds: undefined }),
    );
  });

  it("rejects rows that mix natural keys and ids", async () => {
    const testServer = await createTestServer({
      importOpeningBalances: vi.fn(),
    } as unknown as InventoryImportService);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/inventory/imports/opening-balances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        balances: [
          {
            productId: "00000000-0000-4000-8000-000000000002",
            productSku: "THU-0001",
            siteCode: "SITE-WH",
            storageLocationCode: "WH-A",
            batchNumber: "LOT-1",
            quantityOnHand: 100,
            expiryDate: "2028-01-05",
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors: Array<{ message: string }> };
    expect(body.errors.some((issue) => issue.message.includes("exactly one of productId or productSku"))).toBe(true);
  });

  it("reports import conflicts with the service message", async () => {
    const testServer = await createTestServer({
      importOpeningBalances: vi
        .fn()
        .mockRejectedValue(new Error("Storage location WH-A already has stock for batch LOT-1")),
    } as unknown as InventoryImportService);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/inventory/imports/opening-balances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        balances: [
          {
            productSku: "THU-0001",
            siteCode: "SITE-WH",
            storageLocationCode: "WH-A",
            batchNumber: "LOT-1",
            quantityOnHand: 100,
            expiryDate: "2028-01-05",
          },
        ],
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "import_conflict",
      title: "Storage location WH-A already has stock for batch LOT-1",
    });
  });

  it("reports an unavailable database", async () => {
    const testServer = await createTestServer(undefined);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/inventory/imports/opening-balances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        balances: [
          {
            productSku: "THU-0001",
            siteCode: "SITE-WH",
            storageLocationCode: "WH-A",
            batchNumber: "LOT-1",
            quantityOnHand: 100,
            expiryDate: "2028-01-05",
          },
        ],
      }),
    });

    expect(response.status).toBe(503);
  });
});
