import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { customerFirstPaidResponseSchema, salesDocumentsResponseSchema } from "../contracts/sales.ts";
import { createTrustedRequestMiddleware } from "../middleware/trusted-request.ts";
import { accessToken, testAccessTokenVerifier } from "../test-access-tokens.ts";
import type { SalesRepository } from "./sales-repository.ts";
import { createSalesRouter } from "./sales-routes.ts";

const serviceSecret = "test-service-secret-1234567890123456";
const siteA = "00000000-0000-4000-8000-00000000000a";
const siteB = "00000000-0000-4000-8000-00000000000b";
const documentId = "00000000-0000-4000-8000-0000000000d1";
const customerId = "00000000-0000-4000-8000-0000000000c1";
const period = "from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z";

const identityHeader = (overrides: Parameters<typeof accessToken>[0]): Promise<string> =>
  accessToken({ roles: ["Pharmacy Manager"], siteIds: [siteA], ...overrides });

describe("internal analytics routes", () => {
  let server: Server | undefined;
  let url: string;
  const listSalesDocuments = vi.fn();
  const listCustomerFirstPaid = vi.fn();

  beforeEach(async () => {
    listSalesDocuments.mockReset();
    listCustomerFirstPaid.mockReset();
    listCustomerFirstPaid.mockResolvedValue([{ customerId, firstPaidAt: "2026-09-15T00:00:00.000Z" }]);
    listSalesDocuments.mockResolvedValue([
      { id: documentId, kind: "order", siteId: siteA, customerId, createdAt: "2026-10-15T12:00:00.000Z" },
    ]);
    const app = express();
    app.use(createTrustedRequestMiddleware({ verifier: testAccessTokenVerifier, serviceSecret }));
    app.use(
      createSalesRouter({ listSalesDocuments, listCustomerFirstPaid } as unknown as SalesRepository, {
        catalogServiceUrl: "http://catalog.test",
        inventoryServiceUrl: "http://inventory.test",
        identityServiceUrl: "http://identity.test",
      }),
    );
    server = createServer(app);
    const listening = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", () => listening.resolve());
    await listening.promise;
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    const closed = Promise.withResolvers<void>();
    server?.close((error) => (error ? closed.reject(error) : closed.resolve()));
    await closed.promise;
    server = undefined;
  });

  it("answers the documents of the scope the service forwards, in the response contract", async () => {
    const response = await fetch(`${url}/internal/analytics/sales-documents?${period}`, {
      headers: { "x-internal-service-secret": serviceSecret, "x-actor-site-ids": siteA },
    });

    expect(response.status).toBe(200);
    const body = salesDocumentsResponseSchema.parse(await response.json());
    expect(body.documents).toStrictEqual([
      { id: documentId, kind: "order", siteId: siteA, customerId, createdAt: "2026-10-15T12:00:00.000Z" },
    ]);
    expect(listSalesDocuments).toHaveBeenCalledWith({
      from: new Date("2026-10-01T00:00:00.000Z"),
      to: new Date("2026-11-01T00:00:00.000Z"),
      siteIds: [siteA],
    });
  });

  it("answers the first payment ever for the customers of the forwarded scope", async () => {
    const response = await fetch(`${url}/internal/analytics/customer-first-paid?${period}`, {
      headers: { "x-internal-service-secret": serviceSecret, "x-actor-site-ids": siteA },
    });

    expect(response.status).toBe(200);
    const body = customerFirstPaidResponseSchema.parse(await response.json());
    expect(body.customers).toStrictEqual([{ customerId, firstPaidAt: "2026-09-15T00:00:00.000Z" }]);
    expect(listCustomerFirstPaid).toHaveBeenCalledWith({
      from: new Date("2026-10-01T00:00:00.000Z"),
      to: new Date("2026-11-01T00:00:00.000Z"),
      siteIds: [siteA],
    });
  });

  it("refuses the first-paid read without the service secret too", async () => {
    const response = await fetch(`${url}/internal/analytics/customer-first-paid?${period}`);

    expect(response.status).toBe(401);
    expect(listCustomerFirstPaid).not.toHaveBeenCalled();
  });

  it("does not let a siteId query step outside the forwarded scope", async () => {
    await fetch(`${url}/internal/analytics/sales-documents?${period}&siteId=${siteB}`, {
      headers: { "x-internal-service-secret": serviceSecret, "x-actor-site-ids": siteA },
    });

    expect(listSalesDocuments).toHaveBeenCalledWith(expect.objectContaining({ siteIds: [siteA] }));
  });

  it("reads every site when the service forwards no scope", async () => {
    await fetch(`${url}/internal/analytics/sales-documents?${period}`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });

    expect(listSalesDocuments).toHaveBeenCalledWith(expect.objectContaining({ siteIds: undefined }));
  });

  it("refuses a Pharmacy Manager's access token, which may not read the internal analytics", async () => {
    const response = await fetch(`${url}/internal/analytics/sales-documents?${period}`, {
      headers: { authorization: await identityHeader({ actorType: "employee" }) },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ status: 403, code: "service_required" });
    expect(listSalesDocuments).not.toHaveBeenCalled();
  });

  it("refuses a Platform Admin's access token too", async () => {
    const response = await fetch(`${url}/internal/analytics/sales-documents?${period}`, {
      headers: { authorization: await identityHeader({ roles: ["Platform Admin"], siteIds: [] }) },
    });

    expect(response.status).toBe(403);
    expect(listSalesDocuments).not.toHaveBeenCalled();
  });

  it("refuses a shopper's access token", async () => {
    const response = await fetch(`${url}/internal/analytics/sales-documents?${period}`, {
      headers: { authorization: await identityHeader({ actorType: "customer", roles: [], siteIds: [] }) },
    });

    expect(response.status).toBe(403);
    expect(listSalesDocuments).not.toHaveBeenCalled();
  });

  it("refuses a service-secret call that names an employee actor type", async () => {
    const response = await fetch(`${url}/internal/analytics/sales-documents?${period}`, {
      headers: { "x-internal-service-secret": serviceSecret, "x-actor-type": "employee" },
    });

    expect(response.status).toBe(403);
    expect(listSalesDocuments).not.toHaveBeenCalled();
  });

  it("answers 401 to a caller with neither an access token nor the service secret", async () => {
    const response = await fetch(`${url}/internal/analytics/sales-documents?${period}`);

    expect(response.status).toBe(401);
    expect(listSalesDocuments).not.toHaveBeenCalled();
  });

  it("answers 400 invalid_request when a bound is missing or is not an ISO date-time", async () => {
    const missingTo = await fetch(`${url}/internal/analytics/sales-documents?from=2026-10-01T00:00:00.000Z`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });
    const notIso = await fetch(`${url}/internal/analytics/sales-documents?from=1%20Oct&to=2026-11-01T00:00:00.000Z`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });

    expect(missingTo.status).toBe(400);
    expect(await missingTo.json()).toMatchObject({ code: "invalid_request" });
    expect(notIso.status).toBe(400);
    expect(await notIso.json()).toMatchObject({ code: "invalid_request" });
    expect(listSalesDocuments).not.toHaveBeenCalled();
  });
});
