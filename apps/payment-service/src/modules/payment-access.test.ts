import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPaymentRouter } from "./payment-routes.ts";
import type { PaymentRepository } from "./payment-repository.ts";

const invoiceId = "00000000-0000-4000-8000-0000000000bb";
const actorId = "00000000-0000-4000-8000-0000000000cc";

type Kind = "online" | "counter";

describe("payment write roles at the route", () => {
  let kind: Kind = "online";
  const writes: string[] = [];
  const repository = {
    getInvoice: () =>
      Promise.resolve({
        id: invoiceId,
        status: "Paid",
        customerId: null,
        orderId: kind === "online" ? "00000000-0000-4000-8000-0000000000dd" : null,
      }),
    markCashPaid: () => {
      writes.push("cash");
      return Promise.resolve({ id: invoiceId, status: "Paid" });
    },
    refund: () => {
      writes.push("refund");
      return Promise.resolve({ id: invoiceId, status: "Refunded" });
    },
  } as unknown as PaymentRepository;

  const app = express();
  app.use(express.json());
  app.use(
    createPaymentRouter(repository, {
      salesServiceUrl: "http://sales.test",
      catalogServiceUrl: "http://catalog.test",
    }),
  );
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = app.listen(0, "127.0.0.1");
    const listening = Promise.withResolvers<void>();
    server.once("listening", () => listening.resolve());
    await listening.promise;
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    await closed.promise;
  });

  beforeEach(() => {
    writes.length = 0;
  });

  const post = (path: string, roles: string | undefined, body: unknown = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Actor-Type": "employee",
        "X-Actor-Id": actorId,
        ...(roles === undefined ? {} : { "X-Actor-Roles": roles }),
      },
      body: JSON.stringify(body),
    });

  describe("confirm-counter and cash-paid", () => {
    for (const path of ["confirm-counter", "cash-paid"]) {
      it(`${path}: a Pharmacist confirms cash`, async () => {
        const response = await post(`/payments/${invoiceId}/${path}`, "Pharmacist");
        expect(response.status).toBe(200);
        expect(writes).toStrictEqual(["cash"]);
      });

      it(`${path}: Platform Admin alone is refused and nothing is written`, async () => {
        const response = await post(`/payments/${invoiceId}/${path}`, "Platform Admin");
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "role_forbidden" });
        expect(writes).toStrictEqual([]);
      });

      it(`${path}: a Pharmacy Manager is refused`, async () => {
        const response = await post(`/payments/${invoiceId}/${path}`, "Pharmacy Manager");
        expect(response.status).toBe(403);
        expect(writes).toStrictEqual([]);
      });

      it(`${path}: a caller with no roles header is refused`, async () => {
        const response = await post(`/payments/${invoiceId}/${path}`, undefined);
        expect(response.status).toBe(403);
        expect(writes).toStrictEqual([]);
      });
    }
  });

  describe("refund by invoice kind", () => {
    const reason = { reason: "Khách đổi ý" };

    it("refunds an online-order invoice for a Pharmacy Manager", async () => {
      kind = "online";
      const response = await post(`/payments/${invoiceId}/refund`, "Pharmacy Manager", reason);
      expect(response.status).toBe(200);
      expect(writes).toStrictEqual(["refund"]);
    });

    it("refunds an online-order invoice for Platform Admin", async () => {
      kind = "online";
      const response = await post(`/payments/${invoiceId}/refund`, "Platform Admin", reason);
      expect(response.status).toBe(200);
      expect(writes).toStrictEqual(["refund"]);
    });

    it("refuses an online-order invoice for a Pharmacist before any write", async () => {
      kind = "online";
      const response = await post(`/payments/${invoiceId}/refund`, "Pharmacist", reason);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "role_forbidden" });
      expect(writes).toStrictEqual([]);
    });

    it("refunds a counter invoice for a Pharmacist", async () => {
      kind = "counter";
      const response = await post(`/payments/${invoiceId}/refund`, "Pharmacist", reason);
      expect(response.status).toBe(200);
      expect(writes).toStrictEqual(["refund"]);
    });

    it("refuses a counter invoice for Platform Admin alone before any write", async () => {
      kind = "counter";
      const response = await post(`/payments/${invoiceId}/refund`, "Platform Admin", reason);
      expect(response.status).toBe(403);
      expect(writes).toStrictEqual([]);
    });

    it("refuses a counter invoice for a Pharmacy Manager before any write", async () => {
      kind = "counter";
      const response = await post(`/payments/${invoiceId}/refund`, "Pharmacy Manager", reason);
      expect(response.status).toBe(403);
      expect(writes).toStrictEqual([]);
    });

    it("refuses an empty reason and one over 500 characters", async () => {
      kind = "online";
      expect((await post(`/payments/${invoiceId}/refund`, "Pharmacy Manager", { reason: "   " })).status).toBe(400);
      expect(
        (await post(`/payments/${invoiceId}/refund`, "Pharmacy Manager", { reason: "a".repeat(501) })).status,
      ).toBe(400);
      expect(writes).toStrictEqual([]);
    });
  });
});
