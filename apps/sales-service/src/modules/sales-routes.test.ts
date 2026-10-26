import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { OrderStock } from "./orders/application/order-stock.ts";
import { InsufficientStockError, InventoryRequestError } from "./orders/infrastructure/inventory-reservations.ts";
import { encodeCursor } from "../shared/page-cursor.ts";
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

const createTestServer = async (
  repository: SalesRepository,
  orderStock: Partial<OrderStock> = {},
): Promise<{ server: Server; url: string }> => {
  const app = express();
  app.use(express.json());
  app.use(
    createSalesRouter(repository, {
      catalogServiceUrl: "http://catalog.test",
      inventoryServiceUrl: "http://inventory.test",
      identityServiceUrl: "http://identity.test",
      orderStock: orderStock as OrderStock,
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

  it("refuses an order line whose product has no active price, without writing the order", async () => {
    const createOrder = vi.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({ id: ids.prescription });
    const repository = { createOrder, getOrder: vi.fn() } as unknown as SalesRepository;
    const responder = async (url: string): Promise<Response> => {
      if (String(url).includes("/pricing/active")) return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ id: ids.productA, name: "Thuốc kê đơn mẫu" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    vi.stubGlobal("fetch", vi.fn(responder));
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        selectedStoreId: ids.site,
        fulfillmentType: "pickup",
        lines: [{ productId: ids.productA, productUnitId: ids.unitA, quantity: 1 }],
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: 409,
      code: "product_unpriced",
      productId: ids.productA,
    });
    expect(createOrder).not.toHaveBeenCalled();
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
      .mockResolvedValue({ rows: [], nextCursor: undefined });
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
      .mockResolvedValue({ rows: [], nextCursor: undefined });
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
      .mockResolvedValue({ rows: [], nextCursor: undefined });
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
      .mockResolvedValue({ rows: [], nextCursor: undefined });
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

describe("sales paged lists and count API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
  });

  const position = { at: "2026-10-08T08:00:00.123456Z", id: ids.prescription };

  it("carries the next cursor in a header only when another page follows", async () => {
    const listOrders = vi
      .fn<(input: Parameters<SalesRepository["listOrders"]>[0]) => Promise<unknown>>()
      .mockResolvedValueOnce({ rows: [{ id: ids.prescription }], nextCursor: encodeCursor(position) })
      .mockResolvedValueOnce({ rows: [{ id: ids.actor }], nextCursor: undefined });
    const testServer = await createTestServer({ listOrders } as unknown as SalesRepository);
    server = testServer.server;

    const first = await httpFetch(`${testServer.url}/orders?limit=1`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "employee" },
    });
    expect(await first.json()).toEqual([{ id: ids.prescription }]);
    expect(first.headers.get("x-next-cursor")).toBe(encodeCursor(position));
    expect(listOrders.mock.calls[0]?.[0]).toMatchObject({ limit: 1, after: undefined });

    const last = await httpFetch(`${testServer.url}/orders?limit=1&cursor=${encodeCursor(position)}&q=abc`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "employee" },
    });
    expect(last.headers.has("x-next-cursor")).toBe(false);
    expect(listOrders.mock.calls[1]?.[0]).toMatchObject({ limit: 1, q: "abc", after: position });
  });

  it("answers a tampered or repeated cursor as invalid_cursor without listing", async () => {
    const listPrescriptions = vi.fn();
    const testServer = await createTestServer({ listPrescriptions } as unknown as SalesRepository);
    server = testServer.server;

    const tampered = await httpFetch(`${testServer.url}/prescriptions?cursor=not-a-cursor!`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "employee" },
    });
    expect(tampered.status).toBe(400);
    expect(tampered.headers.get("content-type")).toContain("application/problem+json");
    expect(await tampered.json()).toEqual({ title: "Invalid cursor", status: 400, code: "invalid_cursor" });

    const repeated = await httpFetch(`${testServer.url}/counter-transactions?cursor=a&cursor=b`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "employee" },
    });
    expect(repeated.status).toBe(400);
    expect(await repeated.json()).toMatchObject({ code: "invalid_cursor" });
    expect(listPrescriptions).not.toHaveBeenCalled();
  });

  it("counts prescriptions with the list's status and site scope, excluding the named states", async () => {
    const countPrescriptions = vi
      .fn<(input: Parameters<SalesRepository["countPrescriptions"]>[0]) => Promise<number>>()
      .mockResolvedValue(7);
    const testServer = await createTestServer({ countPrescriptions } as unknown as SalesRepository);
    server = testServer.server;

    const response = await httpFetch(
      `${testServer.url}/prescriptions/count?status=Pending&excludeStatus=Dispensed,Cancelled`,
      { headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "employee", "x-actor-site-ids": ids.site } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 7 });
    expect(countPrescriptions.mock.calls[0]?.[0]).toEqual({
      siteIds: [ids.site],
      status: "Pending",
      excludeStatuses: ["Dispensed", "Cancelled"],
    });
  });

  it("serves the operations dashboard's count as a service with no actor of its own", async () => {
    const countPrescriptions = vi.fn().mockResolvedValue(3);
    const testServer = await createTestServer({ countPrescriptions } as unknown as SalesRepository);
    server = testServer.server;

    const response = await httpFetch(`${testServer.url}/prescriptions/count?excludeStatus=Dispensed,Cancelled`, {
      headers: { "X-Actor-Type": "system", "x-actor-site-ids": ids.site },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 3 });
    expect(countPrescriptions.mock.calls[0]?.[0]).toMatchObject({ siteIds: [ids.site] });
  });

  it("refuses an unknown excluded state, a shopper, and an anonymous caller", async () => {
    const countPrescriptions = vi.fn();
    const testServer = await createTestServer({ countPrescriptions } as unknown as SalesRepository);
    server = testServer.server;

    const unknownState = await httpFetch(`${testServer.url}/prescriptions/count?excludeStatus=Lost`, {
      headers: { "X-Actor-Type": "system" },
    });
    expect(unknownState.status).toBe(400);
    const shopper = await httpFetch(`${testServer.url}/prescriptions/count`, {
      headers: { "X-Actor-Id": ids.actor, "X-Actor-Type": "customer" },
    });
    expect(shopper.status).toBe(403);
    const anonymous = await httpFetch(`${testServer.url}/prescriptions/count`);
    expect(anonymous.status).toBe(401);
    expect(countPrescriptions).not.toHaveBeenCalled();
  });
});

describe("sales order stock API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
  });

  const catalogResponder = async (url: string): Promise<Response> => {
    const body = String(url).includes("/pricing/active")
      ? { productId: ids.productA, productUnitId: ids.unitA, unitPrice: "45000", currency: "VND" }
      : { id: ids.productA, name: "Paracetamol" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const placeOrder = (url: string) =>
    httpFetch(`${url}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        selectedStoreId: ids.site,
        fulfillmentType: "pickup",
        paymentMethod: "sepay_qr",
        lines: [{ productId: ids.productA, productUnitId: ids.unitA, quantity: 2 }],
      }),
    });
  const order = { id: ids.prescription, customerId: ids.actor, selectedStoreId: ids.site, status: "Pending" };
  const cartLineId = "00000000-0000-4000-8000-0000000000c1";
  const postOrder = (url: string, body: Record<string, unknown>) =>
    httpFetch(`${url}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({
        selectedStoreId: ids.site,
        fulfillmentType: "pickup",
        paymentMethod: "sepay_qr",
        ...body,
      }),
    });
  const cartOrderRepository = (
    selected: Array<{ id: string; productId: string; productUnitId: string; quantity: number }>,
  ) =>
    ({
      createOrder: vi.fn().mockResolvedValue(order),
      getOrder: vi.fn().mockResolvedValue(order),
      getSelectedCartLines: vi.fn().mockResolvedValue(selected),
      clearCart: vi.fn().mockResolvedValue(undefined),
    }) as unknown as SalesRepository;

  it("orders the ticked cart lines the server holds, and removes them only after the stock is held", async () => {
    const repository = cartOrderRepository([
      { id: cartLineId, productId: ids.productA, productUnitId: ids.unitA, quantity: 3 },
    ]);
    const hold = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn(catalogResponder));
    const testServer = await createTestServer(repository, { hold });
    server = testServer.server;

    const response = await postOrder(testServer.url, { fromCart: true });

    expect(response.status).toBe(201);
    expect(repository.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [expect.objectContaining({ productId: ids.productA, productUnitId: ids.unitA, quantity: 3 })],
      }),
    );
    expect(hold).toHaveBeenCalledWith(order, [{ productId: ids.productA, quantity: 3 }]);
    expect(repository.clearCart).toHaveBeenCalledWith(ids.actor, [cartLineId]);
    expect(vi.mocked(repository.clearCart).mock.invocationCallOrder[0]).toBeGreaterThan(
      hold.mock.invocationCallOrder[0]!,
    );
  });

  it("refuses an order from the cart when no line is ticked, and makes no order", async () => {
    const repository = cartOrderRepository([]);
    vi.stubGlobal("fetch", vi.fn(catalogResponder));
    const testServer = await createTestServer(repository, { hold: vi.fn() });
    server = testServer.server;

    const response = await postOrder(testServer.url, { fromCart: true });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "cart_selection_empty" });
    expect(repository.createOrder).not.toHaveBeenCalled();
  });

  it("leaves the cart as it was when the stock cannot be held", async () => {
    const repository = cartOrderRepository([
      { id: cartLineId, productId: ids.productA, productUnitId: ids.unitA, quantity: 1 },
    ]);
    vi.stubGlobal("fetch", vi.fn(catalogResponder));
    const testServer = await createTestServer(repository, {
      hold: vi.fn().mockRejectedValue(new InsufficientStockError()),
    });
    server = testServer.server;

    const response = await postOrder(testServer.url, { fromCart: true });

    expect(response.status).toBe(409);
    expect(repository.clearCart).not.toHaveBeenCalled();
  });

  it("never touches the cart for an order that names its own lines", async () => {
    const repository = cartOrderRepository([]);
    vi.stubGlobal("fetch", vi.fn(catalogResponder));
    const testServer = await createTestServer(repository, { hold: vi.fn().mockResolvedValue(undefined) });
    server = testServer.server;

    const response = await postOrder(testServer.url, {
      lines: [{ productId: ids.productA, productUnitId: ids.unitA, quantity: 2 }],
    });

    expect(response.status).toBe(201);
    expect(repository.getSelectedCartLines).not.toHaveBeenCalled();
    expect(repository.clearCart).not.toHaveBeenCalled();
  });

  it.each([
    ["lines", { lines: [{ productId: ids.productA, productUnitId: ids.unitA, quantity: 1 }] }],
    ["fromCart", { fromCart: true }],
  ])("refuses an order with a prescription-only product, whether it comes by %s", async (_label, body) => {
    const repository = cartOrderRepository([
      { id: cartLineId, productId: ids.productA, productUnitId: ids.unitA, quantity: 1 },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/pricing/active")
          ? new Response(
              JSON.stringify({ productId: ids.productA, productUnitId: ids.unitA, unitPrice: "1", currency: "VND" }),
              { status: 200 },
            )
          : new Response(JSON.stringify({ id: ids.productA, name: "Amoxicillin", prescriptionRequired: true }), {
              status: 200,
            }),
      ),
    );
    const hold = vi.fn();
    const testServer = await createTestServer(repository, { hold });
    server = testServer.server;

    const response = await postOrder(testServer.url, body);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "prescription_required", productId: ids.productA });
    expect(repository.createOrder).not.toHaveBeenCalled();
    expect(hold).not.toHaveBeenCalled();
    expect(repository.clearCart).not.toHaveBeenCalled();
  });

  it.each([
    [
      "both lines and fromCart",
      { fromCart: true, lines: [{ productId: ids.productA, productUnitId: ids.unitA, quantity: 1 }] },
    ],
    ["neither lines nor fromCart", {}],
  ])("rejects an order that sends %s", async (_label, body) => {
    const repository = cartOrderRepository([]);
    const testServer = await createTestServer(repository, { hold: vi.fn() });
    server = testServer.server;

    const response = await postOrder(testServer.url, body);

    expect(response.status).toBe(400);
    expect(repository.createOrder).not.toHaveBeenCalled();
  });

  it("holds the stock of the store for the lines it priced, and answers 201 with the order", async () => {
    const createOrder = vi.fn().mockResolvedValue(order);
    const hold = vi.fn().mockResolvedValue(undefined);
    const repository = { createOrder, getOrder: vi.fn().mockResolvedValue(order) } as unknown as SalesRepository;
    vi.stubGlobal("fetch", vi.fn(catalogResponder));
    const testServer = await createTestServer(repository, { hold });
    server = testServer.server;

    const response = await placeOrder(testServer.url);

    expect(response.status).toBe(201);
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: "sepay_qr" }));
    expect(hold).toHaveBeenCalledWith(order, [{ productId: ids.productA, quantity: 2 }]);
  });

  it.each([
    ["the store cannot cover the order", new InsufficientStockError(), 409, "insufficient_stock"],
    ["inventory cannot be reached", new InventoryRequestError("down"), 503, "stock_unavailable"],
  ])("tells the shopper when %s", async (_label, failure, status, code) => {
    const repository = {
      createOrder: vi.fn().mockResolvedValue(order),
      getOrder: vi.fn(),
    } as unknown as SalesRepository;
    vi.stubGlobal("fetch", vi.fn(catalogResponder));
    const testServer = await createTestServer(repository, { hold: vi.fn().mockRejectedValue(failure) });
    server = testServer.server;

    const response = await placeOrder(testServer.url);

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });

  const transition = (url: string, body: unknown, headers: Record<string, string>) =>
    httpFetch(`${url}/orders/${ids.prescription}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const staff = { "X-Actor-Id": "00000000-0000-4000-8000-0000000000aa", "X-Actor-Type": "employee" };
  const shopper = { "X-Actor-Id": ids.actor, "X-Actor-Type": "customer" };

  it("never lets a shopper confirm or hand over their own order", async () => {
    const consume = vi.fn();
    const transitionOrder = vi.fn();
    const repository = {
      getOrder: vi.fn().mockResolvedValue({ ...order, paymentStatus: "Pending" }),
      transitionOrder,
    } as unknown as SalesRepository;
    const testServer = await createTestServer(repository, { consume });
    server = testServer.server;

    for (const status of ["Confirmed", "Delivering", "Completed"]) {
      const response = await transition(testServer.url, { status }, shopper);
      expect(response.status).toBe(403);
    }

    expect(consume).not.toHaveBeenCalled();
    expect(transitionOrder).not.toHaveBeenCalled();
  });

  it("lets a shopper withdraw an unpaid order and frees its stock, but not a paid one", async () => {
    const releaseQuietly = vi.fn().mockResolvedValue(undefined);
    const getOrder = vi.fn().mockResolvedValue({ ...order, paymentStatus: "Pending" });
    const transitionOrder = vi.fn().mockResolvedValue({ ...order, status: "Cancelled" });
    const repository = { getOrder, transitionOrder } as unknown as SalesRepository;
    const testServer = await createTestServer(repository, { releaseQuietly });
    server = testServer.server;

    const withdrawn = await transition(testServer.url, { status: "Cancelled" }, shopper);
    getOrder.mockResolvedValue({ ...order, status: "Confirmed", paymentStatus: "Paid" });
    const refused = await transition(testServer.url, { status: "Cancelled" }, shopper);

    expect(withdrawn.status).toBe(200);
    expect(releaseQuietly).toHaveBeenCalledTimes(1);
    expect(refused.status).toBe(403);
  });

  it("takes the stock off the shelf before staff hand an order over, and refuses an illegal move first", async () => {
    const consume = vi.fn().mockResolvedValue(undefined);
    const getOrder = vi.fn().mockResolvedValue({ ...order, status: "Ready", paymentStatus: "Paid" });
    const transitionOrder = vi.fn().mockResolvedValue({ ...order, status: "Completed" });
    const repository = { getOrder, transitionOrder } as unknown as SalesRepository;
    const testServer = await createTestServer(repository, { consume });
    server = testServer.server;

    const handedOver = await transition(testServer.url, { status: "Completed" }, staff);
    getOrder.mockResolvedValue({ ...order, status: "Pending", paymentStatus: "Pending" });
    const illegal = await transition(testServer.url, { status: "Completed" }, staff);

    expect(handedOver.status).toBe(200);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(illegal.status).toBe(500);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("keeps the order as it was when inventory cannot hand the goods over", async () => {
    const getOrder = vi.fn().mockResolvedValue({ ...order, status: "Ready", paymentStatus: "Paid" });
    const transitionOrder = vi.fn();
    const repository = { getOrder, transitionOrder } as unknown as SalesRepository;
    const testServer = await createTestServer(repository, {
      consume: vi.fn().mockRejectedValue(new InventoryRequestError("down")),
    });
    server = testServer.server;

    const response = await transition(testServer.url, { status: "Completed" }, staff);

    expect(response.status).toBe(502);
    expect(transitionOrder).not.toHaveBeenCalled();
  });
});

describe("sales cart API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
    vi.unstubAllGlobals();
  });

  /** Catalog answers `GET /products/:id`; the ids in `prescriptionOnly` are marked prescription-only. */
  const stubCatalog = (prescriptionOnly: string[] = []) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const productId = String(url).split("/products/")[1];
        return new Response(
          JSON.stringify({
            id: productId,
            name: "Product",
            prescriptionRequired: prescriptionOnly.includes(productId!),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

  const emptyCart = { id: ids.site, lines: [] };
  const cartLine = { productId: ids.productA, productUnitId: ids.unitA, quantity: 2 };
  const mergeLine = { ...cartLine, selected: true };
  const cartRepository = () => ({
    getOrCreateCart: vi.fn().mockResolvedValue(emptyCart),
    addCartLine: vi.fn().mockResolvedValue(emptyCart),
    clearCart: vi.fn().mockResolvedValue(emptyCart),
    setCartSelection: vi.fn().mockResolvedValue(emptyCart),
    updateCartLine: vi.fn().mockResolvedValue(emptyCart),
    mergeLocalCart: vi.fn().mockResolvedValue(emptyCart),
  });
  const startCartServer = async (repository: object) => {
    const testServer = await createTestServer(repository as SalesRepository);
    server = testServer.server;
    return testServer;
  };

  it("answers 401 and sets no cookie on every cart route without a signed-in customer", async () => {
    const repository = cartRepository();
    const testServer = await startCartServer(repository);
    const requests = [
      { method: "GET", path: "/carts", body: undefined },
      { method: "POST", path: "/carts/lines", body: cartLine },
      { method: "DELETE", path: "/carts", body: {} },
      { method: "PATCH", path: `/carts/lines/${ids.lineA}`, body: { quantity: 1 } },
      { method: "PATCH", path: "/carts/selection", body: { selected: true } },
      { method: "POST", path: "/carts/merge", body: { lines: [mergeLine] } },
    ];

    for (const request of requests) {
      const response = await httpFetch(`${testServer.url}${request.path}`, {
        method: request.method,
        ...(request.body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(request.body) }),
      });
      expect(response.status, `${request.method} ${request.path}`).toBe(401);
      expect(response.headers.get("set-cookie"), `${request.method} ${request.path}`).toBeNull();
    }
    for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
  });

  it("reads the signed-in customer's cart and sets no cookie", async () => {
    const repository = cartRepository();
    const testServer = await startCartServer(repository);

    const response = await httpFetch(`${testServer.url}/carts`, { headers: { "X-Actor-Id": ids.actor } });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(repository.getOrCreateCart).toHaveBeenCalledWith(ids.actor);
  });

  it("adds a line to the signed-in customer's cart", async () => {
    const repository = cartRepository();
    stubCatalog();
    const testServer = await startCartServer(repository);

    const response = await httpFetch(`${testServer.url}/carts/lines`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify(cartLine),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(repository.addCartLine).toHaveBeenCalledWith(ids.actor, cartLine);
  });

  it("hands the signed-in customer's local lines to the merge and sets no cookie", async () => {
    const repository = cartRepository();
    stubCatalog();
    const testServer = await startCartServer(repository);

    const response = await httpFetch(`${testServer.url}/carts/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({ lines: [mergeLine] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(repository.mergeLocalCart).toHaveBeenCalledWith(ids.actor, [mergeLine]);
  });

  it("keeps a prescription-only product out of the cart", async () => {
    const repository = cartRepository();
    stubCatalog([ids.productA]);
    const testServer = await startCartServer(repository);

    const response = await httpFetch(`${testServer.url}/carts/lines`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify(cartLine),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "prescription_required", productId: ids.productA });
    expect(repository.addCartLine).not.toHaveBeenCalled();
  });

  it("drops a prescription-only line from a merge and still merges the others", async () => {
    const repository = cartRepository();
    stubCatalog([ids.productB]);
    const testServer = await startCartServer(repository);

    const response = await httpFetch(`${testServer.url}/carts/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify({ lines: [mergeLine, { ...mergeLine, productId: ids.productB }] }),
    });

    expect(response.status).toBe(200);
    expect(repository.mergeLocalCart).toHaveBeenCalledWith(ids.actor, [mergeLine]);
  });

  it("lets nothing into the cart when the catalog cannot say whether a product is prescription-only", async () => {
    const repository = cartRepository();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const testServer = await startCartServer(repository);

    const response = await httpFetch(`${testServer.url}/carts/lines`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      body: JSON.stringify(cartLine),
    });

    expect(response.status).toBe(500);
    expect(repository.addCartLine).not.toHaveBeenCalled();
  });

  it.each([
    ["no body", undefined],
    ["an empty line list", { lines: [] }],
    ["more than 200 lines", { lines: Array.from({ length: 201 }, () => mergeLine) }],
    ["a line without a tick", { lines: [cartLine] }],
  ])("rejects a merge with %s", async (_label, body) => {
    const repository = cartRepository();
    const testServer = await startCartServer(repository);

    const response = await httpFetch(`${testServer.url}/carts/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Actor-Id": ids.actor },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    expect(response.status).toBe(400);
    expect(repository.mergeLocalCart).not.toHaveBeenCalled();
  });

  it("ticks the named lines on PATCH /carts/selection, and every line when none are named", async () => {
    const repository = cartRepository();
    const testServer = await startCartServer(repository);
    const send = (body: unknown) =>
      httpFetch(`${testServer.url}/carts/selection`, {
        method: "PATCH",
        headers: { "X-Actor-Id": ids.actor, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const some = await send({ selected: true, lineIds: [ids.productA] });
    const all = await send({ selected: false });

    expect(some.status).toBe(200);
    expect(all.status).toBe(200);
    expect(repository.setCartSelection).toHaveBeenNthCalledWith(1, ids.actor, true, [ids.productA]);
    expect(repository.setCartSelection).toHaveBeenNthCalledWith(2, ids.actor, false, undefined);
  });

  it("rejects a selection without a boolean and an empty lineIds list", async () => {
    const repository = cartRepository();
    const testServer = await startCartServer(repository);
    const send = (body: unknown) =>
      httpFetch(`${testServer.url}/carts/selection`, {
        method: "PATCH",
        headers: { "X-Actor-Id": ids.actor, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const missing = await send({ lineIds: [ids.productA] });
    const empty = await send({ selected: true, lineIds: [] });

    expect(missing.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(repository.setCartSelection).not.toHaveBeenCalled();
  });
});
