import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InternalIdentityContext } from "../contracts/common.ts";
import { paidInvoicesAnalyticsResponseSchema } from "../contracts/payment.ts";
import { createTrustedRequestMiddleware, signInternalIdentityContext } from "../middleware/trusted-request.ts";
import {
  PAID_INVOICE_LINES_ANALYTICS_CAP,
  PAID_INVOICES_ANALYTICS_CAP,
  createPaymentRouter,
} from "./payment-routes.ts";
import type { PaymentRepository } from "./payment-repository.ts";

const identitySecret = "test-identity-secret-1234567890123456";
const serviceSecret = "test-service-secret-1234567890123456";
const orderId = "00000000-0000-4000-8000-0000000000d1";
const prescriptionId = "00000000-0000-4000-8000-0000000000e1";
const since = "2026-10-01T00:00:00.000Z";

type StoredInvoice = {
  orderId: string | null;
  prescriptionId: string | null;
  amount: string;
  createdAt: Date;
  lines: Array<{ productId: string | null; description: string; quantity: number; unitPrice: number }>;
};

const identityHeader = (overrides: Partial<InternalIdentityContext>): string =>
  signInternalIdentityContext(
    {
      version: "v1",
      requestId: "req-paid-analytics",
      correlationId: "corr-paid-analytics",
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: ["Pharmacy Manager"],
      siteIds: [],
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      audience: "payment-service",
      ...overrides,
    },
    identitySecret,
  );

describe("GET /internal/analytics/paid-invoices", () => {
  let server: Server | undefined;
  let url: string;
  let stored: StoredInvoice[] = [];
  const listPaidInvoicesSince = vi.fn();

  beforeEach(async () => {
    stored = [
      {
        orderId,
        prescriptionId: null,
        amount: "45000.00",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        lines: [
          {
            productId: "00000000-0000-4000-8000-0000000000f1",
            description: "Paracetamol",
            quantity: 2,
            unitPrice: 20000,
          },
        ],
      },
      {
        orderId: null,
        prescriptionId,
        amount: "120000.50",
        createdAt: new Date("2026-10-15T12:00:00.000Z"),
        lines: [
          {
            productId: "00000000-0000-4000-8000-0000000000f2",
            description: "Amoxicillin",
            quantity: 3,
            unitPrice: 40000,
          },
          { productId: null, description: "Phí giao hàng", quantity: 1, unitPrice: 500 },
        ],
      },
    ];
    listPaidInvoicesSince.mockReset();
    // Honours the limit the way the SQL does: at most that many of the stored rows.
    listPaidInvoicesSince.mockImplementation((_since: Date, limit: number) => Promise.resolve(stored.slice(0, limit)));
    const app = express();
    app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret, expectedAudience: "payment-service" }));
    app.use(
      createPaymentRouter({ listPaidInvoicesSince } as unknown as PaymentRepository, {
        salesServiceUrl: "http://sales.test",
        catalogServiceUrl: "http://catalog.test",
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

  it("answers the Paid invoices since the bound with a numeric amount and an ISO createdAt", async () => {
    const response = await fetch(`${url}/internal/analytics/paid-invoices?since=${since}`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });

    expect(response.status).toBe(200);
    const body = paidInvoicesAnalyticsResponseSchema.parse(await response.json());
    expect(body.invoices).toStrictEqual([
      {
        orderId,
        prescriptionId: null,
        amount: 45000,
        createdAt: "2026-10-01T00:00:00.000Z",
        lines: [
          {
            productId: "00000000-0000-4000-8000-0000000000f1",
            description: "Paracetamol",
            quantity: 2,
            unitPrice: 20000,
          },
        ],
      },
      {
        orderId: null,
        prescriptionId,
        amount: 120000.5,
        createdAt: "2026-10-15T12:00:00.000Z",
        lines: [
          {
            productId: "00000000-0000-4000-8000-0000000000f2",
            description: "Amoxicillin",
            quantity: 3,
            unitPrice: 40000,
          },
          { productId: null, description: "Phí giao hàng", quantity: 1, unitPrice: 500 },
        ],
      },
    ]);
    expect(listPaidInvoicesSince).toHaveBeenCalledWith(new Date(since), PAID_INVOICES_ANALYTICS_CAP + 1);
  });

  it("answers a range of exactly the cap in full", async () => {
    const row = stored[0] as StoredInvoice;
    stored = Array.from({ length: PAID_INVOICES_ANALYTICS_CAP }, () => row);

    const response = await fetch(`${url}/internal/analytics/paid-invoices?since=${since}`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });

    expect(response.status).toBe(200);
    const body = paidInvoicesAnalyticsResponseSchema.parse(await response.json());
    expect(body.invoices).toHaveLength(PAID_INVOICES_ANALYTICS_CAP);
  });

  it("answers 422 analytics_range_too_large for one invoice over the cap, never a cut-short list", async () => {
    const row = stored[0] as StoredInvoice;
    stored = Array.from({ length: PAID_INVOICES_ANALYTICS_CAP + 1 }, () => row);

    const response = await fetch(`${url}/internal/analytics/paid-invoices?since=${since}`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ status: 422, code: "analytics_range_too_large" });
  });

  it("answers 422 analytics_range_too_large for more invoice lines than the cap, never a cut-short list", async () => {
    const line = (stored[0] as StoredInvoice).lines[0] as StoredInvoice["lines"][number];
    stored = [
      {
        orderId,
        prescriptionId: null,
        amount: "45000.00",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        lines: Array.from({ length: PAID_INVOICE_LINES_ANALYTICS_CAP + 1 }, () => line),
      },
    ];

    const response = await fetch(`${url}/internal/analytics/paid-invoices?since=${since}`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ status: 422, code: "analytics_range_too_large" });
  });

  it("answers 400 invalid_request when since is missing or not an ISO date-time", async () => {
    const missing = await fetch(`${url}/internal/analytics/paid-invoices`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });
    const notIso = await fetch(`${url}/internal/analytics/paid-invoices?since=yesterday`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });

    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "invalid_request" });
    expect(notIso.status).toBe(400);
    expect(await notIso.json()).toMatchObject({ code: "invalid_request" });
    expect(listPaidInvoicesSince).not.toHaveBeenCalled();
  });

  it("refuses an employee's identity context, whatever the role", async () => {
    const response = await fetch(`${url}/internal/analytics/paid-invoices?since=${since}`, {
      headers: { "x-internal-identity-context": identityHeader({ actorType: "employee", roles: ["Platform Admin"] }) },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ status: 403, code: "service_required" });
    expect(listPaidInvoicesSince).not.toHaveBeenCalled();
  });

  it("refuses a shopper's identity context", async () => {
    const response = await fetch(`${url}/internal/analytics/paid-invoices?since=${since}`, {
      headers: {
        "x-internal-identity-context": identityHeader({ actorType: "customer", roles: [], siteIds: [] }),
      },
    });

    expect(response.status).toBe(403);
    expect(listPaidInvoicesSince).not.toHaveBeenCalled();
  });

  it("refuses a service-secret call that names an employee actor type", async () => {
    const response = await fetch(`${url}/internal/analytics/paid-invoices?since=${since}`, {
      headers: { "x-internal-service-secret": serviceSecret, "x-actor-type": "employee" },
    });

    expect(response.status).toBe(403);
    expect(listPaidInvoicesSince).not.toHaveBeenCalled();
  });

  it("answers 401 to a caller with neither an identity context nor the service secret", async () => {
    const response = await fetch(`${url}/internal/analytics/paid-invoices?since=${since}`);

    expect(response.status).toBe(401);
    expect(listPaidInvoicesSince).not.toHaveBeenCalled();
  });
});
