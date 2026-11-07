import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOperationsRouter } from "./operations-routes.ts";
import { encodePageCursor } from "./page-cursor.ts";
import type { AuditFilters, OperationsRepository } from "./operations-repository.ts";

const position = { sortAt: "2026-10-24T10:00:00.000001Z", id: "00000000-0000-4000-8000-0000000000aa" };

describe("audit paging routes", () => {
  const auditCalls: AuditFilters[] = [];
  let auditPage: { rows: unknown[]; next: typeof position | undefined } = { rows: [], next: undefined };
  const repository = {
    listAudit: (filters: AuditFilters) => {
      auditCalls.push(filters);
      return Promise.resolve(auditPage);
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

  it("limits a Pharmacy Manager and a Pharmacist to the history of one order or prescription", async () => {
    auditCalls.length = 0;
    auditPage = { rows: [], next: undefined };
    const entityId = "00000000-0000-4000-8000-0000000000bb";
    const as = (roles: string) => ({ headers: { "x-actor-type": "employee", "x-actor-roles": roles } });
    for (const roles of ["Pharmacy Manager", "Pharmacist"]) {
      expect((await fetch(`${base}/audit/logs?entityType=order&entityId=${entityId}`, as(roles))).status).toBe(200);
      expect((await fetch(`${base}/audit/logs?entityType=prescription&entityId=${entityId}`, as(roles))).status).toBe(
        200,
      );
      // The whole log, another entity, or a record type with no id is refused.
      for (const query of ["", "?entityType=order", `?entityType=user&entityId=${entityId}`, `?entityId=${entityId}`]) {
        const refused = await fetch(`${base}/audit/logs${query}`, as(roles));
        expect(refused.status, `${roles} ${query}`).toBe(403);
        expect(await refused.json()).toMatchObject({ code: "role_forbidden" });
      }
    }
    expect(auditCalls).toHaveLength(4);
    // Platform Admin still reads the whole log.
    expect((await fetch(`${base}/audit/logs`, as("Platform Admin"))).status).toBe(200);
  });

  it("adds the actor's name to the history of one record, and only for a record", async () => {
    const actorId = "00000000-0000-4000-8000-000000000003";
    const entityId = "00000000-0000-4000-8000-0000000000bb";
    auditPage = {
      rows: [
        { eventId: "x", actorId },
        { eventId: "y", actorId: null },
      ],
      next: undefined,
    };
    const named = express();
    named.use(
      createOperationsRouter(repository, {
        namesOf: (ids) => Promise.resolve(new Map(ids.map((id) => [id, "Dược sĩ A"]))),
      }),
    );
    const namedServer = named.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => namedServer.once("listening", () => resolve()));
    const url = `http://127.0.0.1:${(namedServer.address() as AddressInfo).port}`;
    try {
      const forRecord = await (await fetch(`${url}/audit/logs?entityType=order&entityId=${entityId}`)).json();
      expect(forRecord).toStrictEqual([
        { eventId: "x", actorId, actorName: "Dược sĩ A" },
        { eventId: "y", actorId: null },
      ]);
      const wholeLog = await (await fetch(`${url}/audit/logs`)).json();
      expect(wholeLog).toStrictEqual([
        { eventId: "x", actorId },
        { eventId: "y", actorId: null },
      ]);
    } finally {
      await new Promise<void>((resolve) => namedServer.close(() => resolve()));
    }
  });

  it("answers 400 invalid_cursor for a tampered audit cursor", async () => {
    auditCalls.length = 0;
    const response = await fetch(`${base}/audit/logs?cursor=abc`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: 400, code: "invalid_cursor" });
    expect(auditCalls).toHaveLength(0);
  });
});
