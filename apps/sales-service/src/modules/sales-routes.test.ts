import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SalesRepository } from "./sales-repository.ts";
import { createSalesRouter } from "./sales-routes.ts";

const httpFetch = globalThis.fetch.bind(globalThis);
const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  prescription: "00000000-0000-4000-8000-000000000002",
  lineA: "00000000-0000-4000-8000-000000000003",
  lineB: "00000000-0000-4000-8000-000000000004",
  productA: "00000000-0000-4000-8000-000000000005",
  productB: "00000000-0000-4000-8000-000000000006",
  unitA: "00000000-0000-4000-8000-000000000007",
  unitB: "00000000-0000-4000-8000-000000000008",
  batchA: "00000000-0000-4000-8000-000000000009",
  batchB: "00000000-0000-4000-8000-000000000010",
  site: "00000000-0000-4000-8000-000000000011",
  location: "00000000-0000-4000-8000-000000000012",
};

const createTestServer = async (repository: SalesRepository): Promise<{ server: Server; url: string }> => {
  const app = express();
  app.use(express.json());
  app.use(createSalesRouter(repository, { inventoryServiceUrl: "http://inventory.test" }));
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

describe("sales prescription API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
  });

  it("creates a multi-line prescription and reserves every line", async () => {
    const createPrescription = vi
      .fn<(input: Parameters<SalesRepository["createPrescription"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, status: "Pending" });
    const setPrescriptionReservation = vi
      .fn<(id: string, reservationId: string) => Promise<unknown>>()
      .mockResolvedValue(undefined);
    const getPrescription = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, status: "Pending", lines: [] });
    const repository = {
      createPrescription,
      setPrescriptionReservation,
      getPrescription,
    } as unknown as SalesRepository;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/prescriptions`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        siteId: ids.site,
        storageLocationId: ids.location,
        patientName: "API Patient",
        lines: [
          { productId: ids.productA, productUnitId: ids.unitA, prescribedQuantity: 2 },
          { productId: ids.productB, productUnitId: ids.unitB, prescribedQuantity: 3 },
        ],
      }),
    });

    expect(response.status).toBe(201);
    const input = createPrescription.mock.calls[0]?.[0];
    expect(input?.createdBy).toBe(ids.actor);
    expect(input?.lines.map((line) => line.productId)).toEqual([ids.productA, ids.productB]);
    expect(setPrescriptionReservation).toHaveBeenCalledWith(ids.prescription, ids.prescription);
  });

  it("replays an idempotent prescription creation without reserving twice", async () => {
    const createPrescription = vi
      .fn<(input: Parameters<SalesRepository["createPrescription"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, status: "Pending", idempotentReplay: true });
    const setPrescriptionReservation = vi.fn().mockResolvedValue(undefined);
    const repository = { createPrescription, setPrescriptionReservation } as unknown as SalesRepository;
    const inventoryFetch = vi.fn();
    vi.stubGlobal("fetch", inventoryFetch);
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/prescriptions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Actor-Id": ids.actor,
        "Idempotency-Key": "prescription-create-key",
      },
      body: JSON.stringify({
        siteId: ids.site,
        storageLocationId: ids.location,
        patientName: "API Patient",
        lines: [{ productId: ids.productA, productUnitId: ids.unitA, prescribedQuantity: 2 }],
      }),
    });

    expect(response.status).toBe(201);
    expect(createPrescription.mock.calls[0]?.[0].idempotencyKey).toBe("prescription-create-key");
    expect(setPrescriptionReservation).not.toHaveBeenCalled();
    expect(inventoryFetch).not.toHaveBeenCalled();
  });

  it("dispenses multiple prescription lines and consumes the reservation", async () => {
    const getPrescription = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, reservationId: ids.prescription, status: "Pending", lines: [] });
    const dispensePrescription = vi
      .fn<
        (
          id: string,
          lines: Array<{ prescriptionLineId: string; productBatchId: string; dispensedQuantity: number }>,
          actorId: string,
        ) => Promise<unknown>
      >()
      .mockResolvedValue({ id: ids.prescription, status: "Dispensed" });
    const repository = { getPrescription, dispensePrescription } as unknown as SalesRepository;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/prescriptions/${ids.prescription}/dispense`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        lines: [
          { prescriptionLineId: ids.lineA, productBatchId: ids.batchA, dispensedQuantity: 2 },
          { prescriptionLineId: ids.lineB, productBatchId: ids.batchB, dispensedQuantity: 3 },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(dispensePrescription.mock.calls[0]?.[1].map((line) => line.prescriptionLineId)).toEqual([
      ids.lineA,
      ids.lineB,
    ]);
    expect(dispensePrescription.mock.calls[0]?.[2]).toBe(ids.actor);
  });
});

describe("sales order listing API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
  });

  it("lists every shopper's orders for pharmacy staff and only the caller's own for a customer", async () => {
    const listOrders = vi
      .fn<(input: Parameters<SalesRepository["listOrders"]>[0]) => Promise<unknown>>()
      .mockResolvedValue([]);
    const repository = { listOrders } as unknown as SalesRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const staffResponse = await httpFetch(`${testServer.url}/orders?status=Confirmed&paymentStatus=Paid&limit=25`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "employee" },
    });
    const staffFilter = listOrders.mock.calls[0]?.[0];
    expect(staffResponse.status).toBe(200);
    expect(staffFilter?.customerId).toBeUndefined();
    expect(staffFilter?.status).toBe("Confirmed");
    expect(staffFilter?.paymentStatus).toBe("Paid");
    expect(staffFilter?.limit).toBe(25);

    const shopperResponse = await httpFetch(`${testServer.url}/orders?status=Confirmed&paymentStatus=Paid`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "customer" },
    });
    const shopperFilter = listOrders.mock.calls[1]?.[0];
    expect(shopperResponse.status).toBe(200);
    expect(shopperFilter?.customerId).toBe(ids.actor);
    expect(shopperFilter?.status).toBe("Confirmed");
    expect(shopperFilter?.paymentStatus).toBeUndefined();
    expect(shopperFilter?.limit).toBe(100);

    const anonymousResponse = await httpFetch(`${testServer.url}/orders`);
    expect(anonymousResponse.status).toBe(401);
    expect(listOrders).toHaveBeenCalledTimes(2);
  });
});

describe("sales prescription ownership API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
  });

  it("scopes a shopper's prescription list to their own records and leaves staff unfiltered", async () => {
    const listPrescriptions = vi
      .fn<(input: Parameters<SalesRepository["listPrescriptions"]>[0]) => Promise<unknown>>()
      .mockResolvedValue([]);
    const repository = { listPrescriptions } as unknown as SalesRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const shopperResponse = await httpFetch(`${testServer.url}/prescriptions?status=Pending&siteId=${ids.site}`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "customer" },
    });
    const shopperFilter = listPrescriptions.mock.calls[0]?.[0];
    expect(shopperResponse.status).toBe(200);
    // The owner filter is what stops a shopper reading every patient's record in the pharmacy.
    expect(shopperFilter?.customerId).toBe(ids.actor);
    expect(shopperFilter?.status).toBe("Pending");
    // A shopper must not be able to widen the read to another site by passing siteId.
    expect(shopperFilter?.siteId).toBeUndefined();

    const staffResponse = await httpFetch(`${testServer.url}/prescriptions?status=Pending&siteId=${ids.site}`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "employee" },
    });
    const staffFilter = listPrescriptions.mock.calls[1]?.[0];
    expect(staffResponse.status).toBe(200);
    expect(staffFilter?.customerId).toBeUndefined();
    expect(staffFilter?.siteId).toBe(ids.site);

    const anonymousResponse = await httpFetch(`${testServer.url}/prescriptions`);
    expect(anonymousResponse.status).toBe(401);
    expect(listPrescriptions).toHaveBeenCalledTimes(2);
  });

  it("hides another shopper's prescription behind a 404", async () => {
    const getPrescription = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, customerId: "somebody-else", patientName: "Bệnh nhân khác" });
    const repository = { getPrescription } as unknown as SalesRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/prescriptions/${ids.prescription}`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "customer" },
    });
    // A 403 would confirm the record exists; 404 keeps another patient's prescription indistinguishable from a miss.
    expect(response.status).toBe(404);
  });

  it("returns a prescription linked to the calling shopper", async () => {
    const getPrescription = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, customerId: ids.actor, patientName: "Chính tôi", lines: [] });
    const repository = { getPrescription } as unknown as SalesRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/prescriptions/${ids.prescription}`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "customer" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { patientName: string };
    expect(body.patientName).toBe("Chính tôi");
  });

  it("links a prescription to the shopper's account when staff record one", async () => {
    const createPrescription = vi
      .fn<(input: Parameters<SalesRepository["createPrescription"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, status: "Pending" });
    const setPrescriptionReservation = vi.fn().mockResolvedValue(undefined);
    const getPrescription = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, status: "Pending", lines: [] });
    const repository = {
      createPrescription,
      setPrescriptionReservation,
      getPrescription,
    } as unknown as SalesRepository;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/prescriptions`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor, "X-Actor-Type": "employee" },
      body: JSON.stringify({
        siteId: ids.site,
        storageLocationId: ids.location,
        patientName: "Khách quen",
        customerId: ids.actor,
        lines: [{ productId: ids.productA, productUnitId: ids.unitA, prescribedQuantity: 1 }],
      }),
    });
    expect(response.status).toBe(201);
    expect(createPrescription.mock.calls[0]?.[0].customerId).toBe(ids.actor);
  });

  it("keeps a walk-in prescription unlinked rather than guessing an owner", async () => {
    const createPrescription = vi
      .fn<(input: Parameters<SalesRepository["createPrescription"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, status: "Pending" });
    const setPrescriptionReservation = vi.fn().mockResolvedValue(undefined);
    const getPrescription = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, status: "Pending", lines: [] });
    const repository = {
      createPrescription,
      setPrescriptionReservation,
      getPrescription,
    } as unknown as SalesRepository;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/prescriptions`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor, "X-Actor-Type": "employee" },
      body: JSON.stringify({
        siteId: ids.site,
        storageLocationId: ids.location,
        patientName: "Khách vãng lai",
        lines: [{ productId: ids.productA, productUnitId: ids.unitA, prescribedQuantity: 1 }],
      }),
    });
    expect(response.status).toBe(201);
    expect(createPrescription.mock.calls[0]?.[0].customerId).toBeNull();
  });
});

describe("sales delivery address API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
  });

  it("updates only the caller's own address and 404s someone else's", async () => {
    const updateDeliveryAddress = vi
      .fn<(customerId: string, id: string, input: unknown) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, label: "Nhà mới" });
    const repository = { updateDeliveryAddress } as unknown as SalesRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/delivery/addresses/${ids.prescription}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor, "X-Actor-Type": "customer" },
      body: JSON.stringify({ label: "Nhà mới" }),
    });
    expect(response.status).toBe(200);
    // Ownership is passed to the repository, never taken from the request body, so one shopper cannot retarget another's row.
    expect(updateDeliveryAddress.mock.calls[0]?.[0]).toBe(ids.actor);
    expect(updateDeliveryAddress.mock.calls[0]?.[1]).toBe(ids.prescription);

    updateDeliveryAddress.mockResolvedValueOnce(undefined);
    const missing = await httpFetch(`${testServer.url}/delivery/addresses/${ids.prescription}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "X-Actor-Id": "another-shopper", "X-Actor-Type": "customer" },
      body: JSON.stringify({ label: "Của người khác" }),
    });
    expect(missing.status).toBe(404);
  });

  it("refuses an anonymous address edit and an out-of-range coordinate", async () => {
    const updateDeliveryAddress = vi.fn();
    const repository = { updateDeliveryAddress } as unknown as SalesRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const anonymous = await httpFetch(`${testServer.url}/delivery/addresses/${ids.prescription}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Không phiên" }),
    });
    expect(anonymous.status).toBe(401);

    const outOfRange = await httpFetch(`${testServer.url}/delivery/addresses/${ids.prescription}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({ latitude: 999 }),
    });
    expect(outOfRange.status).toBe(400);
    expect(updateDeliveryAddress).not.toHaveBeenCalled();
  });
});
