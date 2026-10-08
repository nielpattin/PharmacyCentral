import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { SalesRepository, type PrescriptionStockDispense } from "./sales-repository.ts";
import { createSalesRouter } from "./sales-routes.ts";

const httpFetch = globalThis.fetch.bind(globalThis);
// Every call this router makes to another service carries the shared internal secret, so the helper needs one here.
beforeEach(() => {
  vi.stubEnv("INTERNAL_SERVICE_SECRET", "test-internal-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
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
  app.use(
    createSalesRouter(repository, {
      catalogServiceUrl: "http://catalog.test",
      inventoryServiceUrl: "http://inventory.test",
      identityServiceUrl: "http://identity.test",
    }),
  );
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

  it("answers a fixed problem when inventory refuses the reservation", async () => {
    const createPrescription = vi.fn().mockResolvedValue({ id: ids.prescription, status: "Pending" });
    const cancelPrescription = vi.fn().mockResolvedValue({ id: ids.prescription, status: "Cancelled" });
    const repository = { createPrescription, cancelPrescription } as unknown as SalesRepository;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Insufficient stock", { status: 409 })));
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/prescriptions`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        siteId: ids.site,
        storageLocationId: ids.location,
        patientName: "API Patient",
        lines: [{ productId: ids.productA, productUnitId: ids.unitA, prescribedQuantity: 2 }],
      }),
    });

    // The title is a fixed problem the staff web can translate, so the inventory wording moves into `detail` and
    // the half-written prescription is cancelled rather than left reserved against nothing.
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      title: "Stock could not be reserved",
      status: 409,
      code: "stock_reservation_failed",
      detail: "Insufficient stock",
    });
    expect(cancelPrescription).toHaveBeenCalledWith(ids.prescription, ids.actor);
  });

  // The mocked repository hands the router's stock callback the goods it would take off the shelf.
  const dispensingRepository = () =>
    ({
      dispensePrescription: vi.fn(
        async (
          id: string,
          _lines: unknown,
          _actorId: string,
          dispenseStock: (dispense: PrescriptionStockDispense) => Promise<void>,
        ) => {
          await dispenseStock({
            prescriptionId: id,
            reservationId: ids.prescription,
            siteId: ids.site,
            storageLocationId: ids.location,
            lines: [{ productId: ids.productA, productBatchId: ids.batchA, quantity: 2 }],
          });
          return { id, status: "Dispensed" };
        },
      ),
    }) as unknown as SalesRepository;
  const dispense = (url: string, idempotencyKey?: string) =>
    httpFetch(`${url}/prescriptions/${ids.prescription}/dispense`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Actor-Id": ids.actor,
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        lines: [{ prescriptionLineId: ids.lineA, productBatchId: ids.batchA, dispensedQuantity: 2 }],
      }),
    });
  const sentBody = (init: RequestInit | undefined): unknown =>
    typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

  it("takes the dispensed goods off inventory's shelf as the pharmacist", async () => {
    const fetchMock = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const testServer = await createTestServer(dispensingRepository());
    server = testServer.server;

    const response = await dispense(testServer.url, "retry-key");

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://inventory.test/inventory/dispenses");
    expect(new Headers(init?.headers).get("x-actor-id")).toBe(ids.actor);
    expect(sentBody(init)).toMatchObject({
      reservationId: ids.prescription,
      prescriptionId: ids.prescription,
      siteId: ids.site,
      storageLocationId: ids.location,
      lines: [{ productId: ids.productA, productBatchId: ids.batchA, quantity: 2 }],
    });
  });

  it("sends a retried dispense to inventory under the same dispense id", async () => {
    const fetchMock = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockImplementation(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const testServer = await createTestServer(dispensingRepository());
    server = testServer.server;

    await dispense(testServer.url, "retry-key");
    await dispense(testServer.url, "retry-key");
    await dispense(testServer.url, "other-key");

    const [first, retried, other] = fetchMock.mock.calls.map(
      ([, init]) => z.object({ dispenseId: z.string() }).parse(sentBody(init)).dispenseId,
    );
    expect(retried).toBe(first);
    expect(other).not.toBe(first);
  });

  it("answers inventory's refusal as a dispense conflict that keeps the reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { title: "Stock could not be dispensed", status: 409, detail: "Batch B-1 has expired" },
            { status: 409 },
          ),
        ),
    );
    const testServer = await createTestServer(dispensingRepository());
    server = testServer.server;

    const response = await dispense(testServer.url);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      title: "Prescription could not be dispensed",
      status: 409,
      code: "dispense_rejected",
      detail: "Batch B-1 has expired",
    });
  });

  it("refuses a prescription linked to a customer account identity-service does not know", async () => {
    const createPrescription = vi
      .fn<(input: Parameters<SalesRepository["createPrescription"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, status: "Pending" });
    const repository = { createPrescription } as unknown as SalesRepository;
    const responder = async (url: string): Promise<Response> => {
      if (String(url).includes("/internal/customers/")) return new Response(null, { status: 404 });
      return new Response(null, { status: 201 });
    };
    vi.stubGlobal("fetch", vi.fn(responder));
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

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      title: "Customer account not found",
      status: 400,
      code: "invalid_customer",
    });
    // Nothing was written: a prescription naming an account that does not exist would belong to nobody.
    expect(createPrescription).not.toHaveBeenCalled();
  });

  it("fails closed when identity-service cannot resolve the customer", async () => {
    const createPrescription = vi
      .fn<(input: Parameters<SalesRepository["createPrescription"]>[0]) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.prescription, status: "Pending" });
    const repository = { createPrescription } as unknown as SalesRepository;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("identity-service is unreachable")));
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

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 503, code: "identity_unavailable" });
    expect(createPrescription).not.toHaveBeenCalled();
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
    expect(shopperFilter?.siteIds).toBeUndefined();

    const staffResponse = await httpFetch(`${testServer.url}/prescriptions?status=Pending&siteId=${ids.site}`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "employee" },
    });
    const staffFilter = listPrescriptions.mock.calls[1]?.[0];
    expect(staffResponse.status).toBe(200);
    expect(staffFilter?.customerId).toBeUndefined();
    expect(staffFilter?.siteIds).toEqual([ids.site]);

    // The operations dashboard reads the register as a service, which carries no actor of its own.
    const serviceResponse = await httpFetch(`${testServer.url}/prescriptions`, {
      headers: { "X-Actor-Type": "system", "x-actor-site-ids": ids.site },
    });
    expect(serviceResponse.status).toBe(200);
    expect(listPrescriptions.mock.calls[2]?.[0]).toEqual({ siteIds: [ids.site], status: undefined, limit: 100 });

    const anonymousResponse = await httpFetch(`${testServer.url}/prescriptions`);
    expect(anonymousResponse.status).toBe(401);
    expect(listPrescriptions).toHaveBeenCalledTimes(3);
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

describe("sales counter transaction API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
  });

  it("refuses a shopper the takings behind the counter", async () => {
    const listCounterTransactions = vi
      .fn<(input: Parameters<SalesRepository["listCounterTransactions"]>[0]) => Promise<unknown>>()
      .mockResolvedValue([]);
    const repository = { listCounterTransactions } as unknown as SalesRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/counter-transactions`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "customer" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ title: "Forbidden", status: 403, code: "forbidden" });
    expect(listCounterTransactions).not.toHaveBeenCalled();
  });

  it("lists the counter's takings for staff, narrowed to the requested site", async () => {
    const listCounterTransactions = vi
      .fn<(input: Parameters<SalesRepository["listCounterTransactions"]>[0]) => Promise<unknown>>()
      .mockResolvedValue([]);
    const repository = { listCounterTransactions } as unknown as SalesRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/counter-transactions?siteId=${ids.site}&limit=25`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "employee" },
    });

    expect(response.status).toBe(200);
    expect(listCounterTransactions.mock.calls[0]?.[0]).toEqual({ limit: 25, siteIds: [ids.site] });
  });

  it("requires an actor before it decides on the counter list", async () => {
    const listCounterTransactions = vi.fn();
    const repository = { listCounterTransactions } as unknown as SalesRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/counter-transactions`);
    expect(response.status).toBe(401);
    expect(listCounterTransactions).not.toHaveBeenCalled();
  });
});
