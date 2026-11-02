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

  it("admits the service secret alone on an internal analytics read and refuses a verified identity", async () => {
    const app = express();
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.get("/internal/analytics/products", (_req, res) => {
      res.json({ ok: true });
    });

    const { server, url } = await startServer(app);
    activeServer = server;

    const authorization = await bearerHeaders({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: ["Platform Admin"],
    });
    const employee = await fetch(`${url}/internal/analytics/products`, {
      headers: authorization,
    });
    expect(employee.status).toBe(403);
    expect(await employee.json()).toMatchObject({ code: "service_required" });

    const service = await fetch(`${url}/internal/analytics/products`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });
    expect(service.status).toBe(200);

    const disguised = await fetch(`${url}/internal/analytics/products`, {
      headers: { "x-internal-service-secret": serviceSecret, "x-actor-type": "employee" },
    });
    expect(disguised.status).toBe(403);
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
  const callAs = async (
    actorType: "employee" | "customer",
    roles: string[],
    path: string,
    method: string,
  ): Promise<Response> => {
    const app = express();
    app.use(express.json());
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.use((_request, response) => response.json({ ok: true }));
    const { server, url } = await startServer(app);
    activeServer = server;
    const authorization = await bearerHeaders({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType,
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

  it("refuses a Pharmacy Manager creating a site, which only Platform Admin may do", async () => {
    const response = await callAs("employee", ["Pharmacy Manager"], "/sites", "POST");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("lets a Pharmacy Manager edit a site", async () => {
    const response = await callAs(
      "employee",
      ["Pharmacy Manager"],
      "/sites/00000000-0000-4000-8000-000000000010",
      "PUT",
    );
    expect(response.status).toBe(200);
  });

  it("refuses Platform Admin the synonym approval, which a clinician makes", async () => {
    const response = await callAs(
      "employee",
      ["Platform Admin"],
      "/products/search-synonyms/00000000-0000-4000-8000-000000000020/approve",
      "POST",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("lets a Pharmacist approve a synonym group", async () => {
    const response = await callAs(
      "employee",
      ["Pharmacist"],
      "/products/search-synonyms/00000000-0000-4000-8000-000000000020/approve",
      "POST",
    );
    expect(response.status).toBe(200);
  });

  it("refuses a shopper the staff site list with employee_required", async () => {
    const response = await callAs("customer", [], "/sites", "GET");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "employee_required" });
  });
});

describe("trusted request access tokens", () => {
  let activeServer: Server | undefined;

  afterEach(async () => {
    if (!activeServer) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    activeServer.close(() => resolve());
    activeServer = undefined;
    await promise;
  });

  const start = async (): Promise<{ url: string; seen: () => Record<string, string | undefined> }> => {
    const app = express();
    let captured: Record<string, string | undefined> = {};
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.use((req, res) => {
      captured = {
        actorId: req.header("x-actor-id"),
        actorType: req.header("x-actor-type"),
        roles: req.header("x-actor-roles"),
      };
      res.json({ ok: true });
    });
    const { server, url } = await startServer(app);
    activeServer = server;
    return { url, seen: () => captured };
  };

  it("sets the actor headers from the token and overwrites what the client sent", async () => {
    const { url, seen } = await start();
    const response = await fetch(`${url}/sites`, {
      headers: {
        ...(await bearerHeaders({
          actorId: "00000000-0000-4000-8000-000000000001",
          actorType: "employee",
          roles: ["Pharmacist"],
        })),
        "x-actor-id": spoofedActorId,
        "x-actor-roles": "Platform Admin",
      },
    });
    expect(response.status).toBe(200);
    expect(seen()).toEqual({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: "Pharmacist",
    });
  });

  it("refuses an expired token", async () => {
    const { url } = await start();
    const headers = await bearerHeaders(
      { actorId: "00000000-0000-4000-8000-000000000001", actorType: "employee", roles: ["Pharmacist"] },
      new Date(Date.now() - 2 * 86_400_000),
    );
    expect((await fetch(`${url}/sites`, { headers })).status).toBe(401);
  });

  it("refuses a token whose account must change its password", async () => {
    const { url } = await start();
    const headers = await bearerHeaders({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: ["Pharmacist"],
      passwordChangeRequired: true,
    });
    const response = await fetch(`${url}/sites`, { headers });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "password_change_required" });
  });
});
