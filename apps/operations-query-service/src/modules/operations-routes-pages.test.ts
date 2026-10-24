import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOperationsRouter } from "./operations-routes.ts";
import { encodePageCursor } from "./page-cursor.ts";
import type { AuditFilters, OperationsRepository } from "./operations-repository.ts";

const position = { sortAt: "2026-10-24T10:00:00.000001Z", id: "00000000-0000-4000-8000-0000000000aa" };

describe("audit and report paging routes", () => {
  const auditCalls: AuditFilters[] = [];
  const reportCalls: Array<{ reportType: string | undefined; options: unknown }> = [];
  let auditPage: { rows: unknown[]; next: typeof position | undefined } = { rows: [], next: undefined };
  let reportPage: { rows: unknown[]; next: typeof position | undefined } = { rows: [], next: undefined };
  const repository = {
    listAudit: (filters: AuditFilters) => {
      auditCalls.push(filters);
      return Promise.resolve(auditPage);
    },
    report: (reportType: string | undefined, options: unknown) => {
      reportCalls.push({ reportType, options });
      return Promise.resolve(reportPage);
    },
  } as unknown as OperationsRepository;

  const app = express();
  app.use(createOperationsRouter(repository));
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("passes q, the cursor and the limit to the audit list and sends X-Next-Cursor while rows remain", async () => {
    auditCalls.length = 0;
    auditPage = { rows: [{ eventId: "x" }], next: position };
    const response = await fetch(
      `${base}/audit/logs?q=order&limit=1&cursor=${encodePageCursor(position)}&entityType=order`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-next-cursor")).toBe(encodePageCursor(position));
    expect(await response.json()).toStrictEqual([{ eventId: "x" }]);
    expect(auditCalls[0]).toMatchObject({ q: "order", limit: 1, cursor: position, entityType: "order" });
  });

  it("sends no X-Next-Cursor on the last audit page", async () => {
    auditPage = { rows: [], next: undefined };
    const response = await fetch(`${base}/audit/logs`);
    expect(response.headers.get("x-next-cursor")).toBeNull();
  });

  it("answers 400 invalid_cursor for a tampered audit cursor", async () => {
    auditCalls.length = 0;
    const response = await fetch(`${base}/audit/logs?cursor=abc`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: 400, code: "invalid_cursor" });
    expect(auditCalls).toHaveLength(0);
  });

  it("pages reports with the default size of 100 and answers 400 invalid_cursor for a bad cursor", async () => {
    reportCalls.length = 0;
    reportPage = { rows: [{ id: "r" }], next: position };
    const response = await fetch(`${base}/reports?reportType=payment.invoice.paid.v1`);
    expect(response.headers.get("x-next-cursor")).toBe(encodePageCursor(position));
    expect(reportCalls[0]).toStrictEqual({
      reportType: "payment.invoice.paid.v1",
      options: { limit: 100 },
    });

    const cursored = await fetch(`${base}/reports?cursor=${encodePageCursor(position)}&limit=10`);
    expect(cursored.status).toBe(200);
    expect(reportCalls[1]).toMatchObject({ options: { limit: 10, cursor: position } });

    const invalid = await fetch(`${base}/reports?cursor=0`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "invalid_cursor" });
  });
});
