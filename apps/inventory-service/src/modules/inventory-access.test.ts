import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createInventoryRouter } from "./inventory-routes.ts";
import { createProcurementRouter } from "./procurement-routes.ts";
import type { ProcurementRepository } from "./procurement-repository.ts";
import type { InventoryRepository } from "./inventory-repository.ts";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000099",
  siteA: "00000000-0000-4000-8000-000000000021",
  siteB: "00000000-0000-4000-8000-000000000022",
  siteC: "00000000-0000-4000-8000-000000000023",
  transfer: "00000000-0000-4000-8000-000000000031",
  stocktake: "00000000-0000-4000-8000-000000000032",
  stocktakeLine: "00000000-0000-4000-8000-000000000033",
  adjustment: "00000000-0000-4000-8000-000000000034",
  replenishment: "00000000-0000-4000-8000-000000000035",
  batch: "00000000-0000-4000-8000-000000000036",
};

/** The headers the edge sends after it verifies a staff session: the roles, the actor and the actor's sites. */
const staff = (roles: string, sites?: string[]): Record<string, string> => ({
  "content-type": "application/json",
  "x-actor-roles": roles,
  "X-Actor-Id": ids.actor,
  ...(sites === undefined ? {} : { "x-actor-site-ids": sites.join(",") }),
});

const serve = async (router: express.Router): Promise<{ server: Server; url: string }> => {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) =>
    response.status(500).json({ error: String(error) }),
  );
  const server = createServer(app);
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const createTestServer = (repository: InventoryRepository) => serve(createInventoryRouter(repository));

const createProcurementTestServer = (repository: ProcurementRepository) =>
  serve(createProcurementRouter(repository, { catalogServiceUrl: "http://catalog.test" }));

const closeServer = async (server: Server): Promise<void> => {
  const closed = Promise.withResolvers<void>();
  server.close((error) => (error ? closed.reject(error) : closed.resolve()));
  await closed.promise;
};

describe("purchase orders and goods receipts", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
  });

  it("refuses approval of a purchase order by its creator", async () => {
    const transition = vi.fn();
    const repository = {
      getPurchaseOrder: vi.fn().mockResolvedValue({ id: ids.transfer, siteId: ids.siteA, createdBy: ids.actor }),
      transition,
    } as unknown as ProcurementRepository;
    const testServer = await createProcurementTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/procurement/purchase-orders/${ids.transfer}/action`, {
      method: "POST",
      headers: staff("Pharmacy Manager"),
      body: JSON.stringify({ action: "approve" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "self_approval_forbidden" });
    expect(transition).not.toHaveBeenCalled();
  });

  it("lets a Pharmacy Manager approve an order another manager created", async () => {
    const transition = vi.fn().mockResolvedValue({ id: ids.transfer, status: "Approved" });
    const repository = {
      getPurchaseOrder: vi.fn().mockResolvedValue({ id: ids.transfer, siteId: ids.siteA, createdBy: ids.other }),
      transition,
    } as unknown as ProcurementRepository;
    const testServer = await createProcurementTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/procurement/purchase-orders/${ids.transfer}/action`, {
      method: "POST",
      headers: staff("Pharmacy Manager"),
      body: JSON.stringify({ action: "approve" }),
    });

    expect(response.status).toBe(200);
    expect(transition.mock.calls[0]?.slice(0, 3)).toEqual([ids.transfer, "approve", ids.actor]);
  });

  it("refuses a purchase order at another site before returning it", async () => {
    const repository = {
      getPurchaseOrder: vi.fn().mockResolvedValue({ id: ids.transfer, siteId: ids.siteB, createdBy: ids.other }),
    } as unknown as ProcurementRepository;
    const testServer = await createProcurementTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/procurement/purchase-orders/${ids.transfer}`, {
      headers: staff("Pharmacy Manager", [ids.siteA]),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "site_access_denied" });
  });

  it("refuses a receipt that links an order at a site outside the caller's sites", async () => {
    const createReceipt = vi.fn();
    const repository = {
      getPurchaseOrder: vi.fn().mockResolvedValue({ id: ids.transfer, siteId: ids.siteB, createdBy: ids.other }),
      createReceipt,
    } as unknown as ProcurementRepository;
    const testServer = await createProcurementTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/procurement/goods-receipts`, {
      method: "POST",
      headers: staff("Warehouse Staff", [ids.siteA]),
      body: JSON.stringify({
        receiptNumber: "GR-SCOPE-1",
        supplierId: ids.batch,
        siteId: ids.siteA,
        storageLocationId: ids.batch,
        purchaseOrderId: ids.transfer,
        receivedAt: "2026-01-01T10:00:00.000Z",
        lines: [{ productId: ids.batch, batchNumber: "LOT-1", expiryDate: "2099-01-31", quantity: 1 }],
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "site_access_denied" });
    expect(createReceipt).not.toHaveBeenCalled();
  });
});

/** A transfer from site A to site B, created by someone else. */
const transferFromAtoB = {
  id: ids.transfer,
  sourceSiteId: ids.siteA,
  destinationSiteId: ids.siteB,
  createdBy: ids.other,
};

describe("inventory role, site and separation-of-duties rules", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
  });

  describe("transfers", () => {
    it("refuses a Warehouse Staff member an approval, and writes nothing", async () => {
      const transitionTransfer = vi.fn();
      const repository = {
        getTransfer: vi.fn().mockResolvedValue(transferFromAtoB),
        transitionTransfer,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/transfers/${ids.transfer}/approve`, {
        method: "POST",
        headers: staff("Warehouse Staff"),
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "role_forbidden" });
      expect(transitionTransfer).not.toHaveBeenCalled();
    });

    it("lets a Pharmacy Manager approve a transfer someone else created, recording the manager", async () => {
      const transitionTransfer = vi.fn().mockResolvedValue({ id: ids.transfer, status: "Approved" });
      const repository = {
        getTransfer: vi.fn().mockResolvedValue(transferFromAtoB),
        transitionTransfer,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/transfers/${ids.transfer}/approve`, {
        method: "POST",
        headers: staff("Pharmacy Manager"),
        body: "{}",
      });

      expect(response.status).toBe(200);
      expect(transitionTransfer.mock.calls[0]?.slice(0, 3)).toEqual([ids.transfer, "approve", ids.actor]);
    });

    it("refuses an approval by the transfer's creator", async () => {
      const transitionTransfer = vi.fn();
      const repository = {
        getTransfer: vi.fn().mockResolvedValue({ ...transferFromAtoB, createdBy: ids.actor }),
        transitionTransfer,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/transfers/${ids.transfer}/approve`, {
        method: "POST",
        headers: staff("Pharmacy Manager"),
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "self_approval_forbidden" });
      expect(transitionTransfer).not.toHaveBeenCalled();
    });

    it("refuses a transfer that needs both sites when the creator is assigned to one of them", async () => {
      const createTransfer = vi.fn();
      const repository = { createTransfer } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/transfers`, {
        method: "POST",
        headers: staff("Warehouse Staff", [ids.siteA]),
        body: JSON.stringify({
          transferNumber: "TR-SCOPE-1",
          sourceSiteId: ids.siteA,
          destinationSiteId: ids.siteB,
          lines: [
            {
              productId: ids.batch,
              productBatchId: ids.batch,
              sourceStorageLocationId: ids.batch,
              destinationStorageLocationId: ids.batch,
              quantity: 1,
            },
          ],
        }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "site_access_denied" });
      expect(createTransfer).not.toHaveBeenCalled();
    });

    it("refuses a shipment from a site outside the caller's sites before anything is written", async () => {
      const transitionTransfer = vi.fn();
      const repository = {
        getTransfer: vi.fn().mockResolvedValue(transferFromAtoB),
        transitionTransfer,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/transfers/${ids.transfer}/ship`, {
        method: "POST",
        headers: staff("Warehouse Staff", [ids.siteC]),
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "site_access_denied" });
      expect(transitionTransfer).not.toHaveBeenCalled();
    });
  });

  describe("stocktakes", () => {
    it("refuses a posting by a Pharmacy Manager who counted a line of the session", async () => {
      const postStocktake = vi.fn();
      const repository = {
        getStocktake: vi.fn().mockResolvedValue({
          id: ids.stocktake,
          siteId: ids.siteA,
          lines: [{ id: ids.stocktakeLine, countedBy: ids.actor }],
        }),
        postStocktake,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/stocktakes/${ids.stocktake}/post`, {
        method: "POST",
        headers: staff("Pharmacy Manager"),
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "self_approval_forbidden" });
      expect(postStocktake).not.toHaveBeenCalled();
    });

    it("refuses a posting of a session outside the caller's sites before anything is written", async () => {
      const postStocktake = vi.fn();
      const repository = {
        getStocktake: vi.fn().mockResolvedValue({ id: ids.stocktake, siteId: ids.siteB, lines: [] }),
        postStocktake,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/stocktakes/${ids.stocktake}/post`, {
        method: "POST",
        headers: staff("Pharmacy Manager", [ids.siteA]),
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "site_access_denied" });
      expect(postStocktake).not.toHaveBeenCalled();
    });

    it("refuses a count on a line whose session is outside the caller's sites, before the count is written", async () => {
      const countStocktakeLine = vi.fn();
      const repository = {
        findStocktakeLine: vi.fn().mockResolvedValue({ id: ids.stocktakeLine, stocktakeId: ids.stocktake }),
        getStocktake: vi.fn().mockResolvedValue({ id: ids.stocktake, siteId: ids.siteB, lines: [] }),
        countStocktakeLine,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/stocktake-lines/${ids.stocktakeLine}/count`, {
        method: "POST",
        headers: staff("Warehouse Staff", [ids.siteA]),
        body: JSON.stringify({ countedQuantity: 4 }),
      });

      expect(response.status).toBe(403);
      expect(countStocktakeLine).not.toHaveBeenCalled();
    });
  });

  describe("adjustments", () => {
    it("refuses an approval by the Pharmacy Manager who proposed the adjustment", async () => {
      const transitionAdjustment = vi.fn();
      const repository = {
        getAdjustment: vi.fn().mockResolvedValue({ id: ids.adjustment, siteId: ids.siteA, createdBy: ids.actor }),
        transitionAdjustment,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/adjustments/${ids.adjustment}/approve`, {
        method: "POST",
        headers: staff("Pharmacy Manager"),
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "self_approval_forbidden" });
      expect(transitionAdjustment).not.toHaveBeenCalled();
    });

    it("refuses an approval by Warehouse Staff, who propose adjustments but do not decide them", async () => {
      const transitionAdjustment = vi.fn();
      const repository = {
        getAdjustment: vi.fn().mockResolvedValue({ id: ids.adjustment, siteId: ids.siteA, createdBy: ids.other }),
        transitionAdjustment,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/adjustments/${ids.adjustment}/approve`, {
        method: "POST",
        headers: staff("Warehouse Staff"),
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "role_forbidden" });
      expect(transitionAdjustment).not.toHaveBeenCalled();
    });
  });

  describe("batches and quality", () => {
    it("lets a Pharmacist read batches at their site, narrowed to that site", async () => {
      const listBatches = vi.fn().mockResolvedValue({ rows: [], nextCursor: undefined });
      const repository = { listBatches } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/batches`, {
        headers: staff("Pharmacist", [ids.siteA]),
      });

      expect(response.status).toBe(200);
      expect(listBatches).toHaveBeenCalledWith(expect.objectContaining({ siteIds: [ids.siteA] }), expect.anything());
    });

    it("refuses a Pharmacist a batch change", async () => {
      const createBatch = vi.fn();
      const repository = { createBatch } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/batches`, {
        method: "POST",
        headers: staff("Pharmacist"),
        body: JSON.stringify({
          productId: ids.batch,
          batchNumber: "LOT-1",
          expiryDate: "2099-01-31",
        }),
      });

      expect(response.status).toBe(403);
      expect(createBatch).not.toHaveBeenCalled();
    });

    it("refuses a verdict by Warehouse Staff, who read quality but do not decide it", async () => {
      const reviewBatch = vi.fn();
      const repository = { reviewBatch } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/batches/${ids.batch}/quality`, {
        method: "POST",
        headers: staff("Warehouse Staff"),
        body: JSON.stringify({ decision: "release" }),
      });

      expect(response.status).toBe(403);
      expect(reviewBatch).not.toHaveBeenCalled();
    });

    it("refuses a verdict by the user who recorded the batch's receipt", async () => {
      const reviewBatch = vi.fn();
      const repository = {
        getBatch: vi.fn().mockResolvedValue({ id: ids.batch, createdBy: ids.actor }),
        batchSiteIds: vi.fn().mockResolvedValue([ids.siteA]),
        reviewBatch,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/batches/${ids.batch}/quality`, {
        method: "POST",
        headers: staff("Pharmacist", [ids.siteA]),
        body: JSON.stringify({ decision: "release" }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "self_approval_forbidden" });
      expect(reviewBatch).not.toHaveBeenCalled();
    });

    it("refuses a verdict on a batch that also holds stock at a site outside the caller's sites", async () => {
      const reviewBatch = vi.fn();
      const repository = {
        getBatch: vi.fn().mockResolvedValue({ id: ids.batch, createdBy: ids.other }),
        batchSiteIds: vi.fn().mockResolvedValue([ids.siteA, ids.siteB]),
        reviewBatch,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/batches/${ids.batch}/quality`, {
        method: "POST",
        headers: staff("Pharmacist", [ids.siteA]),
        body: JSON.stringify({ decision: "release" }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "site_access_denied" });
      expect(reviewBatch).not.toHaveBeenCalled();
    });
  });

  describe("replenishment", () => {
    it("lets a Pharmacist list only the requests they made", async () => {
      const listReplenishments = vi.fn().mockResolvedValue({ rows: [], nextCursor: undefined });
      const repository = { listReplenishments } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/replenishment`, {
        headers: staff("Pharmacist", [ids.siteA]),
      });

      expect(response.status).toBe(200);
      expect(listReplenishments).toHaveBeenCalledWith(
        expect.objectContaining({ requestedBy: ids.actor }),
        expect.anything(),
      );
    });

    it("refuses an approval by a Pharmacy Manager, who requests but does not approve", async () => {
      const transitionReplenishment = vi.fn();
      const repository = {
        getReplenishment: vi.fn().mockResolvedValue({
          id: ids.replenishment,
          siteId: ids.siteA,
          requestedBy: ids.other,
        }),
        transitionReplenishment,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/replenishment/${ids.replenishment}/approve`, {
        method: "POST",
        headers: staff("Pharmacy Manager", [ids.siteA]),
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(transitionReplenishment).not.toHaveBeenCalled();
    });

    it("refuses an approval by the requester", async () => {
      const transitionReplenishment = vi.fn();
      const repository = {
        getReplenishment: vi.fn().mockResolvedValue({
          id: ids.replenishment,
          siteId: ids.siteA,
          requestedBy: ids.actor,
        }),
        transitionReplenishment,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/replenishment/${ids.replenishment}/approve`, {
        method: "POST",
        headers: staff("Warehouse Staff"),
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "self_approval_forbidden" });
      expect(transitionReplenishment).not.toHaveBeenCalled();
    });

    it("refuses a cancel by a Pharmacist who did not make the request", async () => {
      const transitionReplenishment = vi.fn();
      const repository = {
        getReplenishment: vi.fn().mockResolvedValue({
          id: ids.replenishment,
          siteId: ids.siteA,
          requestedBy: ids.other,
        }),
        transitionReplenishment,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/replenishment/${ids.replenishment}/cancel`, {
        method: "POST",
        headers: staff("Pharmacist", [ids.siteA]),
        body: "{}",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "role_forbidden" });
      expect(transitionReplenishment).not.toHaveBeenCalled();
    });

    it("lets a Pharmacist cancel the request they made", async () => {
      const transitionReplenishment = vi.fn().mockResolvedValue({ id: ids.replenishment, status: "Cancelled" });
      const repository = {
        getReplenishment: vi.fn().mockResolvedValue({
          id: ids.replenishment,
          siteId: ids.siteA,
          requestedBy: ids.actor,
        }),
        transitionReplenishment,
      } as unknown as InventoryRepository;
      const testServer = await createTestServer(repository);
      server = testServer.server;

      const response = await fetch(`${testServer.url}/inventory/replenishment/${ids.replenishment}/cancel`, {
        method: "POST",
        headers: staff("Pharmacist", [ids.siteA]),
        body: "{}",
      });

      expect(response.status).toBe(200);
      expect(transitionReplenishment.mock.calls[0]?.[1]).toBe("cancel");
    });
  });
});
