import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPaymentRouter } from "./payment-routes.ts";
import { encodePageCursor } from "./page-cursor.ts";
import type { InvoiceListInput, PaymentRepository } from "./payment-repository.ts";

const invoiceId = "00000000-0000-4000-8000-0000000000aa";
const nextPosition = { sortAt: "2026-10-24T10:00:00.000001Z", id: invoiceId };

describe("GET /payments/invoices paging", () => {
  const calls: InvoiceListInput[] = [];
  let nextPage: { rows: unknown[]; next: typeof nextPosition | undefined } = { rows: [], next: undefined };
  const repository = {
    listInvoices: (input: InvoiceListInput) => {
      calls.push(input);
      return Promise.resolve(nextPage);
    },
  } as unknown as PaymentRepository;

  const app = express();
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
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("answers the whole list with no header when no paging parameter is sent", async () => {
    calls.length = 0;
    nextPage = { rows: [{ id: invoiceId }], next: undefined };
    const response = await fetch(`${base}/payments/invoices`, { headers: { "X-Actor-Type": "employee" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-next-cursor")).toBeNull();
    expect(await response.json()).toStrictEqual([{ id: invoiceId }]);
    expect(calls[0]).toMatchObject({ limit: undefined, cursor: undefined, status: undefined, q: undefined });
  });

  it("sends the next cursor in X-Next-Cursor only when another page exists", async () => {
    calls.length = 0;
    nextPage = { rows: [{ id: invoiceId }], next: nextPosition };
    const response = await fetch(`${base}/payments/invoices?limit=1&status=Paid&q=%20PC-%20`, {
      headers: { "X-Actor-Type": "employee" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-next-cursor")).toBe(encodePageCursor(nextPosition));
    expect(calls[0]).toMatchObject({ limit: 1, status: "Paid", q: "PC-" });
  });

  it("clamps an oversized limit to the maximum page", async () => {
    calls.length = 0;
    nextPage = { rows: [], next: undefined };
    await fetch(`${base}/payments/invoices?limit=100000`, { headers: { "X-Actor-Type": "employee" } });
    expect(calls[0]?.limit).toBe(500);
  });

  it("pages at the default size when only a cursor is sent", async () => {
    calls.length = 0;
    nextPage = { rows: [], next: undefined };
    const cursor = encodePageCursor(nextPosition);
    const response = await fetch(`${base}/payments/invoices?cursor=${cursor}`, {
      headers: { "X-Actor-Type": "employee" },
    });
    expect(response.status).toBe(200);
    expect(calls[0]).toMatchObject({ limit: 100, cursor: nextPosition });
  });

  it("answers 400 invalid_cursor for a tampered cursor", async () => {
    calls.length = 0;
    const response = await fetch(`${base}/payments/invoices?limit=2&cursor=0`, {
      headers: { "X-Actor-Type": "employee" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: 400, code: "invalid_cursor" });
    expect(calls).toHaveLength(0);
  });

  it("answers 400 invalid_request for an unknown status or a non-positive limit", async () => {
    const unknownStatus = await fetch(`${base}/payments/invoices?status=Lost`, {
      headers: { "X-Actor-Type": "employee" },
    });
    expect(unknownStatus.status).toBe(400);
    const zeroLimit = await fetch(`${base}/payments/invoices?limit=0`, { headers: { "X-Actor-Type": "employee" } });
    expect(zeroLimit.status).toBe(400);
    expect(await zeroLimit.json()).toMatchObject({ code: "invalid_request" });
  });
});
