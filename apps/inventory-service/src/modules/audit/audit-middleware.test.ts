import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createAuditMiddleware, type AuditRule } from "./audit-middleware.ts";
import type { AuditEntry } from "./audit-recorder.ts";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  entity: "00000000-0000-4000-8000-000000000002",
  site: "00000000-0000-4000-8000-000000000003",
  second: "00000000-0000-4000-8000-000000000004",
};

const rules: readonly AuditRule[] = [
  { method: "POST", route: "/things", entityType: "thing", action: "stock.thing.created" },
  {
    method: "POST",
    route: "/things/:id/:action",
    entityType: "thing",
    action: { prefix: "stock.thing", param: "action" },
  },
  {
    method: "POST",
    route: "/things/:id/action",
    entityType: "thing",
    action: { prefix: "stock.thing", body: "action" },
    details: ["decision"],
  },
  { method: "POST", route: "/batches", entityType: "thing", action: "stock.thing.created", collection: "things" },
];

describe("audit middleware", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  const start = async (): Promise<{ url: string; entries: AuditEntry[] }> => {
    const entries: AuditEntry[] = [];
    const app = express();
    app.use(express.json());
    app.use(createAuditMiddleware(rules, { record: (entry) => (entries.push(entry), Promise.resolve()) }));
    app.post("/things", (request, response) =>
      response.status(201).json({ id: ids.entity, siteId: (request.body as { siteId?: string }).siteId }),
    );
    app.post("/things/:id/reject", (_request, response) => response.status(422).json({ title: "no" }));
    app.post("/things/:id/action", (_request, response) => response.json({ id: ids.entity }));
    app.post("/things/:id/:action", (_request, response) => response.status(204).end());
    app.post("/unaudited", (_request, response) => response.status(201).json({}));
    app.get("/things", (_request, response) => response.json([]));
    app.post("/batches", (_request, response) =>
      response.status(201).json({
        things: [
          { id: ids.entity, siteId: ids.site },
          { id: ids.second, siteId: ids.site },
        ],
      }),
    );
    server = createServer(app);
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    return { url: `http://127.0.0.1:${address.port}`, entries };
  };

  const send = (url: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

  it("records a created entity with the actor, the new id and the site", async () => {
    const { url, entries } = await start();
    await send(url, "/things", { siteId: ids.site, note: "secret" }, { "x-actor-id": ids.actor });
    await settle();
    expect(entries).toEqual([
      {
        action: "stock.thing.created",
        entityType: "thing",
        entityId: ids.entity,
        siteId: ids.site,
        actorId: ids.actor,
      },
    ]);
  });

  it("takes the verb from the path and the id from the path even when the response has no body", async () => {
    const { url, entries } = await start();
    await send(url, `/things/${ids.entity}/approve`);
    await settle();
    expect(entries).toEqual([{ action: "stock.thing.approve", entityType: "thing", entityId: ids.entity }]);
  });

  it("takes the verb and the listed details from the request body", async () => {
    const { url, entries } = await start();
    await send(url, `/things/${ids.entity}/action`, { action: "Cancel", decision: "release", notes: "private" });
    await settle();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "stock.thing.cancel", details: { decision: "release" } });
    expect(JSON.stringify(entries[0])).not.toContain("private");
  });

  it("ignores failed requests, unlisted routes, reads and a verb that is not a plain word", async () => {
    const { url, entries } = await start();
    await send(url, `/things/${ids.entity}/reject`);
    await send(url, "/unaudited");
    await fetch(`${url}/things`);
    await send(url, `/things/${ids.entity}/action`, { action: "Drop Table" });
    await settle();
    expect(entries).toEqual([]);
  });

  it("leaves a service-to-service call to the caller to audit", async () => {
    const { url, entries } = await start();
    await send(url, "/things", {}, { "x-actor-type": "system", "x-actor-id": ids.actor });
    await settle();
    expect(entries).toEqual([]);
  });

  it("drops an actor header that is not a UUID", async () => {
    const { url, entries } = await start();
    await send(url, "/things", {}, { "x-actor-id": "not-a-uuid" });
    await settle();
    expect(entries[0]?.actorId).toBeUndefined();
  });

  it("records each created record of a collection, as the single record would be", async () => {
    const { url, entries } = await start();
    await send(url, "/batches", {}, { "x-actor-id": ids.actor });
    await settle();
    expect(entries).toEqual([
      {
        action: "stock.thing.created",
        entityType: "thing",
        entityId: ids.entity,
        siteId: ids.site,
        actorId: ids.actor,
      },
      {
        action: "stock.thing.created",
        entityType: "thing",
        entityId: ids.second,
        siteId: ids.site,
        actorId: ids.actor,
      },
    ]);
  });
});
