import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPaymentRouter } from "./payment-routes.ts";
import type { PaymentRepository } from "./payment-repository.ts";

const prescriptionId = "00000000-0000-4000-8000-0000000000e1";
const actorId = "00000000-0000-4000-8000-0000000000e2";
const siteA = "00000000-0000-4000-8000-0000000000a1";
const siteB = "00000000-0000-4000-8000-0000000000b1";

const listen = async (app: express.Express): Promise<{ server: Server; base: string }> => {
  const server = app.listen(0, "127.0.0.1");
  const listening = Promise.withResolvers<void>();
  server.once("listening", () => listening.resolve());
  await listening.promise;
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
};

const close = async (server: Server): Promise<void> => {
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
};

describe("POST /payments/prescriptions/:id access", () => {
  const previousSecret = process.env.INTERNAL_SERVICE_SECRET;
  let sales: { server: Server; base: string };
  let payment: { server: Server; base: string };
  let salesSiteId = siteB;
  const salesCalls: Array<Record<string, string | string[] | undefined>> = [];
  const writes: string[] = [];

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
    const salesApp = express();
    salesApp.get("/prescriptions/:id", (request, response) => {
      salesCalls.push({ ...request.headers });
      response.json({ id: request.params.id, siteId: salesSiteId, lines: [] });
    });
    sales = await listen(salesApp);

    const repository = {
      getInvoiceByPrescription: () => Promise.resolve(undefined),
      createInvoice: () => {
        writes.push("create");
        return Promise.resolve({ id: "invoice" });
      },
    } as unknown as PaymentRepository;
    const paymentApp = express();
    paymentApp.use(express.json());
    paymentApp.use(createPaymentRouter(repository, { salesServiceUrl: sales.base, catalogServiceUrl: sales.base }));
    payment = await listen(paymentApp);
  });

  afterAll(async () => {
    await close(payment.server);
    await close(sales.server);
    if (previousSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = previousSecret;
  });

  beforeEach(() => {
    salesCalls.length = 0;
    writes.length = 0;
    salesSiteId = siteB;
  });

  const create = (headers: Record<string, string>) =>
    fetch(`${payment.base}/payments/prescriptions/${prescriptionId}`, {
      method: "POST",
      headers: { "X-Actor-Id": actorId, ...headers },
    });

  it("refuses Platform Admin before reading the prescription or writing", async () => {
    const response = await create({ "X-Actor-Type": "employee", "X-Actor-Roles": "Platform Admin" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
    expect(salesCalls).toHaveLength(0);
    expect(writes).toStrictEqual([]);
  });

  it("refuses a Pharmacist assigned to another site before any invoice write", async () => {
    salesSiteId = siteB;
    const response = await create({
      "X-Actor-Type": "employee",
      "X-Actor-Roles": "Pharmacist",
      "X-Actor-Site-Ids": siteA,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "site_access_denied" });
    expect(writes).toStrictEqual([]);
  });

  it("forwards the caller's access token to sales", async () => {
    salesSiteId = siteA;
    await create({
      Authorization: "Bearer caller-token",
      "X-Actor-Type": "employee",
      "X-Actor-Roles": "Pharmacist",
      "X-Actor-Site-Ids": siteA,
    });
    expect(salesCalls[0]).toMatchObject({ authorization: "Bearer caller-token" });
    expect(salesCalls[0]).not.toHaveProperty("x-actor-roles");
  });

  it("does not limit a caller that carries no site scope", async () => {
    salesSiteId = siteB;
    const response = await create({ "X-Actor-Type": "employee", "X-Actor-Roles": "Pharmacist" });
    expect(response.status).toBe(201);
    expect(writes).toStrictEqual(["create"]);
  });
});
