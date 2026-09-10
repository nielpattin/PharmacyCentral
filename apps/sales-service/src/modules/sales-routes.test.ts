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
