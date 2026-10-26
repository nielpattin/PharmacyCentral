import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProcurementRepository } from "./procurement-repository.ts";
import { createProcurementRouter } from "./procurement-routes.ts";

const httpFetch = globalThis.fetch.bind(globalThis);

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000099",
  supplier: "00000000-0000-4000-8000-000000000002",
  site: "00000000-0000-4000-8000-000000000003",
  location: "00000000-0000-4000-8000-000000000004",
  productA: "00000000-0000-4000-8000-000000000005",
  productB: "00000000-0000-4000-8000-000000000006",
};

const createTestServer = async (repository: ProcurementRepository): Promise<{ server: Server; url: string }> => {
  // The catalog reference check reads the shared internal secret before it calls the catalog.
  vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
  const app = express();
  app.use(express.json());
  // The edge forwards the verified roles; a call without them acts as Platform Admin, which passes every role check.
  app.use((request, _response, next) => {
    if (request.header("x-actor-roles") === undefined) request.headers["x-actor-roles"] = "Platform Admin";
    next();
  });
  app.use(createProcurementRouter(repository, { catalogServiceUrl: "http://catalog.test" }));
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

describe("procurement API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("creates a purchase order with optional metadata", async () => {
    const createPurchaseOrder = vi
      .fn<(input: Parameters<ProcurementRepository["createPurchaseOrder"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000007", status: "Draft" });
    const repository = { createPurchaseOrder } as unknown as ProcurementRepository;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/procurement/purchase-orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        purchaseOrderNumber: "PO-API-001",
        supplierId: ids.supplier,
        siteId: ids.site,
        expectedDate: "2026-02-01",
        lines: [{ productId: ids.productA, orderedQuantity: 10, notes: "Line note" }],
        notes: "Header note",
      }),
    });

    expect(response.status).toBe(201);
    const input = createPurchaseOrder.mock.calls[0]?.[0];
    expect(input?.purchaseOrderNumber).toBe("PO-API-001");
    expect(input?.expectedDate).toBe("2026-02-01");
    expect(input?.lines[0]?.notes).toBe("Line note");
  });

  it("creates a multi-line purchase order after validating catalog references", async () => {
    const createPurchaseOrder = vi
      .fn<(input: Parameters<ProcurementRepository["createPurchaseOrder"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000007", status: "Draft" });
    const repository = { createPurchaseOrder } as unknown as ProcurementRepository;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/procurement/purchase-orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        supplierId: ids.supplier,
        siteId: ids.site,
        lines: [
          { productId: ids.productA, orderedQuantity: 10 },
          { productId: ids.productB, orderedQuantity: 20 },
        ],
        notes: "API test",
      }),
    });

    expect(response.status).toBe(201);
    const purchaseOrderInput = createPurchaseOrder.mock.calls[0]?.[0];
    expect(purchaseOrderInput?.createdBy).toBe(ids.actor);
    expect(purchaseOrderInput?.lines.map((line) => line.productId)).toEqual([ids.productA, ids.productB]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("forwards purchase-order approval and cancellation actions with the actor", async () => {
    const transition = vi
      .fn<(id: string, action: "approve" | "cancel", actorId: string) => Promise<unknown>>()
      .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000007", status: "Approved" });
    const repository = {
      transition,
      getPurchaseOrder: vi
        .fn()
        .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000007", siteId: ids.site, createdBy: ids.other }),
    } as unknown as ProcurementRepository;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const testServer = await createTestServer(repository);
    server = testServer.server;
    const postAction = (action: "approve" | "cancel") =>
      httpFetch(`${testServer.url}/procurement/purchase-orders/00000000-0000-4000-8000-000000000007/action`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
        body: JSON.stringify({ action }),
      });

    expect((await postAction("approve")).status).toBe(200);
    expect((await postAction("cancel")).status).toBe(200);
    expect(transition.mock.calls.map((call) => call.slice(1))).toEqual([
      ["approve", ids.actor],
      ["cancel", ids.actor],
    ]);
  });

  it("creates and reads a goods receipt", async () => {
    const createReceipt = vi
      .fn<(input: Parameters<ProcurementRepository["createReceipt"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000008", status: "Posted" });
    const getReceipt = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000008", lines: [] });
    const repository = { createReceipt, getReceipt } as unknown as ProcurementRepository;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const createResponse = await httpFetch(`${testServer.url}/procurement/goods-receipts`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        receiptNumber: "GR-API-DETAIL-001",
        supplierId: ids.supplier,
        siteId: ids.site,
        storageLocationId: ids.location,
        notes: "Receipt note",
        receivedAt: "2026-01-01T10:00:00.000Z",
        lines: [
          {
            productId: ids.productA,
            batchNumber: "BATCH-A",
            expiryDate: "2027-01-01",
            manufacturedDate: "2025-01-01",
            manufacturer: "Manufacturer",
            quantity: 10,
            notes: "Line note",
          },
        ],
      }),
    });
    const detailResponse = await httpFetch(
      `${testServer.url}/procurement/goods-receipts/00000000-0000-4000-8000-000000000008`,
    );

    expect(createResponse.status).toBe(201);
    expect(detailResponse.status).toBe(200);
    const input = createReceipt.mock.calls[0]?.[0];
    expect(input?.notes).toBe("Receipt note");
    expect(input?.lines[0]?.manufacturedDate).toBe("2025-01-01");
    expect(input?.lines[0]?.manufacturer).toBe("Manufacturer");
    expect(input?.lines[0]?.notes).toBe("Line note");
    expect(getReceipt).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000008");
  });

  it("creates a multi-line goods receipt and converts receivedAt to a Date", async () => {
    const createReceipt = vi
      .fn<(input: Parameters<ProcurementRepository["createReceipt"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000008", status: "Posted" });
    const repository = { createReceipt } as unknown as ProcurementRepository;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/procurement/goods-receipts`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        receiptNumber: "GR-API-001",
        supplierId: ids.supplier,
        siteId: ids.site,
        storageLocationId: ids.location,
        receivedAt: "2026-01-01T10:00:00.000Z",
        lines: [
          { productId: ids.productA, batchNumber: "BATCH-A", expiryDate: "2027-01-01", quantity: 10 },
          { productId: ids.productB, batchNumber: "BATCH-B", expiryDate: "2027-02-01", quantity: 20 },
        ],
      }),
    });

    expect(response.status).toBe(201);
    const receiptInput = createReceipt.mock.calls[0]?.[0];
    expect(receiptInput?.createdBy).toBe(ids.actor);
    expect(receiptInput?.receivedAt).toEqual(new Date("2026-01-01T10:00:00.000Z"));
    expect(receiptInput?.lines.map((line) => line.productId)).toEqual([ids.productA, ids.productB]);
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
