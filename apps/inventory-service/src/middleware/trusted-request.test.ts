import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { bearerHeaders, testVerifier } from "../test-support/access-tokens.ts";
import { createTrustedRequestMiddleware } from "./trusted-request.ts";

const serviceSecret = "test-service-secret-1234567890123456";
const spoofedActorId = "00000000-0000-4000-8000-000000000099";

const startServer = async (app: express.Express): Promise<{ server: Server; url: string }> => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server failed to bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

describe("trusted request actor headers", () => {
  let activeServer: Server | undefined;

  afterEach(async () => {
    if (!activeServer) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    activeServer.close(() => resolve());
    activeServer = undefined;
    await promise;
  });

  it("drops client actor headers on a public request without a valid access token", async () => {
    const app = express();
    let capturedActorId: string | undefined;
    let capturedActorType: string | undefined;

    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret, isPublic: () => true }));
    app.get("/public-check", (req, res) => {
      capturedActorId = req.header("x-actor-id") ?? undefined;
      capturedActorType = req.header("x-actor-type") ?? undefined;
      res.json({ ok: true });
    });

    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/public-check`, {
      headers: { "x-actor-id": spoofedActorId, "x-actor-type": "employee" },
    });
    expect(response.status).toBe(200);
    expect(capturedActorId).toBeUndefined();
    expect(capturedActorType).toBeUndefined();
  });

  it("refuses a non-public request that carries actor headers but no valid access token", async () => {
    const app = express();
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.get("/private-check", (_req, res) => {
      res.json({ ok: true });
    });

    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/private-check`, {
      headers: { "x-actor-id": spoofedActorId, "x-actor-type": "employee" },
    });
    expect(response.status).toBe(401);
  });
});

describe("trusted request role restatement", () => {
  let activeServer: Server | undefined;

  afterEach(async () => {
    if (!activeServer) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    activeServer.close(() => resolve());
    activeServer = undefined;
    await promise;
  });

  // A request the middleware admits reaches the fallback (200).
  const callAs = async (roles: string[], path: string, method: string): Promise<Response> => {
    const app = express();
    app.use(express.json());
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.use((_request, response) => response.json({ ok: true }));
    const { server, url } = await startServer(app);
    activeServer = server;
    const authorization = await bearerHeaders({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles,
      siteIds: ["00000000-0000-4000-8000-000000000010"],
    });
    return fetch(`${url}${path}`, {
      method,
      headers: {
        ...authorization,
        "content-type": "application/json",
      },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
  };

  const transferPath = "/inventory/transfers/00000000-0000-4000-8000-000000000040";

  it("lets a Pharmacy Manager approve a transfer, and refuses Warehouse Staff the approval", async () => {
    expect((await callAs(["Pharmacy Manager"], `${transferPath}/approve`, "POST")).status).toBe(200);
    const refused = await callAs(["Warehouse Staff"], `${transferPath}/approve`, "POST");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("refuses a Pharmacist creating a batch, which Warehouse Staff do", async () => {
    const response = await callAs(["Pharmacist"], "/inventory/batches", "POST");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("lets a Pharmacy Manager post a stocktake, and refuses Warehouse Staff the posting", async () => {
    const stocktakePath = "/inventory/stocktakes/00000000-0000-4000-8000-000000000050/post";
    expect((await callAs(["Pharmacy Manager"], stocktakePath, "POST")).status).toBe(200);
    expect((await callAs(["Warehouse Staff"], stocktakePath, "POST")).status).toBe(403);
  });

  it("admits a Pharmacist or Warehouse Staff to propose a disposal, every staff role to read one, and only a manager to decide", async () => {
    const disposals = "/inventory/disposals";
    const decision = `${disposals}/00000000-0000-4000-8000-000000000070/approve`;
    expect((await callAs(["Pharmacist"], disposals, "GET")).status).toBe(200);
    expect((await callAs(["Warehouse Staff"], disposals, "GET")).status).toBe(200);
    expect((await callAs(["Pharmacy Manager"], disposals, "GET")).status).toBe(200);
    expect((await callAs(["Pharmacist"], disposals, "POST")).status).toBe(200);
    expect((await callAs(["Warehouse Staff"], disposals, "POST")).status).toBe(200);
    expect((await callAs(["Pharmacy Manager"], disposals, "POST")).status).toBe(403);
    expect((await callAs(["Pharmacy Manager"], decision, "POST")).status).toBe(200);
    expect((await callAs(["Pharmacist"], decision, "POST")).status).toBe(403);
    expect((await callAs(["Warehouse Staff"], decision, "POST")).status).toBe(403);
  });

  it("admits a Pharmacy Manager to replenishment suggestions and drafts, lets Platform Admin read them, and refuses the rest", async () => {
    const suggestions = "/procurement/replenishment-suggestions";
    expect((await callAs(["Pharmacy Manager"], suggestions, "GET")).status).toBe(200);
    expect((await callAs(["Pharmacy Manager"], `${suggestions}/draft-orders`, "POST")).status).toBe(200);
    expect((await callAs(["Platform Admin"], suggestions, "GET")).status).toBe(200);
    expect((await callAs(["Platform Admin"], `${suggestions}/draft-orders`, "POST")).status).toBe(403);
    expect((await callAs(["Pharmacist"], suggestions, "GET")).status).toBe(403);
    const refused = await callAs(["Warehouse Staff"], `${suggestions}/draft-orders`, "POST");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("admits only a Pharmacy Manager to create an action plan, every staff role to read and move one, and Platform Admin to reassign", async () => {
    const plans = "/inventory/action-plans";
    const planPath = `${plans}/00000000-0000-4000-8000-000000000060`;
    expect((await callAs(["Pharmacy Manager"], plans, "POST")).status).toBe(200);
    expect((await callAs(["Platform Admin"], plans, "POST")).status).toBe(403);
    expect((await callAs(["Platform Admin"], plans, "GET")).status).toBe(200);
    expect((await callAs(["Platform Admin"], planPath, "PATCH")).status).toBe(200);
    const refused = await callAs(["Pharmacist"], plans, "POST");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "role_forbidden" });
    expect((await callAs(["Warehouse Staff"], plans, "POST")).status).toBe(403);

    expect((await callAs(["Pharmacist"], plans, "GET")).status).toBe(200);
    expect((await callAs(["Warehouse Staff"], plans, "GET")).status).toBe(200);
    expect((await callAs(["Pharmacist"], planPath, "PATCH")).status).toBe(200);
    expect((await callAs(["Warehouse Staff"], planPath, "PATCH")).status).toBe(200);
    expect((await callAs(["Pharmacy Manager"], planPath, "PATCH")).status).toBe(200);
  });

  it("sets the actor headers from a valid token and overwrites what the client sent", async () => {
    const app = express();
    let seen: Record<string, string | undefined> = {};
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.use((req, res) => {
      seen = { actorId: req.header("x-actor-id"), actorType: req.header("x-actor-type"), roles: req.header("x-actor-roles") };
      res.json({ ok: true });
    });
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/inventory/balances`, {
      headers: {
        ...(await bearerHeaders({
          actorId: "00000000-0000-4000-8000-000000000001",
          actorType: "employee",
          roles: ["Warehouse Staff"],
          siteIds: ["00000000-0000-4000-8000-000000000010"],
        })),
        "x-actor-id": spoofedActorId,
        "x-actor-roles": "Platform Admin",
      },
    });
    expect(response.status).toBe(200);
    expect(seen).toEqual({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: "Warehouse Staff",
    });
  });

  it("refuses an expired token", async () => {
    const app = express();
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.use((_req, res) => res.json({ ok: true }));
    const { server, url } = await startServer(app);
    activeServer = server;

    const headers = await bearerHeaders(
      { actorId: "00000000-0000-4000-8000-000000000001", actorType: "employee", roles: ["Warehouse Staff"] },
      new Date(Date.now() - 2 * 86_400_000),
    );
    expect((await fetch(`${url}/inventory/balances`, { headers })).status).toBe(401);
  });

  it("refuses a token whose account must change its password", async () => {
    const app = express();
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.use((_req, res) => res.json({ ok: true }));
    const { server, url } = await startServer(app);
    activeServer = server;

    const headers = await bearerHeaders({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: ["Warehouse Staff"],
      passwordChangeRequired: true,
    });
    const response = await fetch(`${url}/inventory/balances`, { headers });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "password_change_required" });
  });
});
