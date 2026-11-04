import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accessToken, testAccessTokenVerifier } from "../test-access-tokens.ts";

import { createTrustedRequestMiddleware, matchesPathPrefix } from "./trusted-request.ts";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../logger.ts", () => ({ createLogger: () => ({ warn }) }));

const serviceSecret = "test-service-secret-1234567890123456";
const actorId = "00000000-0000-4000-8000-000000000001";
const siteId = "00000000-0000-4000-8000-000000000010";

const employeeToken = (overrides: Parameters<typeof accessToken>[0] = {}) =>
  accessToken({ actorId, roles: ["Pharmacist"], siteIds: [siteId], ...overrides });

const startServer = async (app: express.Express): Promise<{ server: Server; url: string }> => {
  const server = createServer(app);
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server failed to bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const closeServer = async (server: Server): Promise<void> => {
  const closed = Promise.withResolvers<void>();
  server.close((error) => (error ? closed.reject(error) : closed.resolve()));
  await closed.promise;
};

/** Mirrors the sales app: `/delivery/calculate` is public, `/orders` needs a trusted caller, `/health` is exempt. */
const createApp = (): express.Express => {
  const app = express();
  app.use(
    createTrustedRequestMiddleware({
      verifier: testAccessTokenVerifier,
      serviceSecret,
      isPublic: (request) => matchesPathPrefix(request.path, "/delivery/calculate"),
    }),
  );
  const echoActorHeaders = (request: express.Request, response: express.Response) =>
    response.json({
      actorId: request.header("x-actor-id") ?? null,
      actorType: request.header("x-actor-type") ?? null,
      siteIds: request.header("x-actor-site-ids") ?? null,
      requestId: request.header("x-request-id") ?? null,
      roles: request.header("x-actor-roles") ?? null,
    });
  app.all("/delivery/calculate", echoActorHeaders);
  app.all("/orders", echoActorHeaders);
  app.all("/orders/:id/transition", echoActorHeaders);
  app.all("/sales-targets", echoActorHeaders);
  app.all("/prescriptions", echoActorHeaders);
  app.all("/health/live", echoActorHeaders);
  return app;
};

describe("sales trusted request middleware", () => {
  let activeServer: Server | undefined;

  beforeEach(() => {
    warn.mockClear();
  });

  afterEach(async () => {
    if (activeServer) {
      await closeServer(activeServer);
      activeServer = undefined;
    }
  });

  it("drops client-sent actor headers on a public request with no verified token or secret", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/delivery/calculate`, {
      headers: {
        "x-actor-id": "00000000-0000-4000-8000-0000000000aa",
        "x-actor-type": "system",
        "x-actor-site-ids": siteId,
        "x-request-id": "req-from-client",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actorId: null,
      actorType: null,
      siteIds: null,
      roles: null,
      requestId: "req-from-client",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ requestId: "req-from-client" }, expect.any(String));
  });

  it("drops client-sent actor headers on a health route with no verified token or secret", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/health/live`, {
      headers: { "x-actor-id": actorId, "x-actor-type": "employee" },
    });

    expect(await response.json()).toMatchObject({ actorId: null, actorType: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn on a public request that carries no actor header", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/delivery/calculate`);

    expect(response.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the actor headers of a request that presents a valid service secret", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/delivery/calculate`, {
      headers: {
        "x-internal-service-secret": serviceSecret,
        "x-actor-id": actorId,
        "x-actor-type": "employee",
      },
    });

    expect(await response.json()).toMatchObject({ actorId, actorType: "employee" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("defaults a service-secret request without an actor type to system", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/delivery/calculate`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });

    expect(await response.json()).toMatchObject({ actorId: null, actorType: "system" });
  });

  it("overwrites spoofed actor headers with the values of a verified token", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const header = await employeeToken({ actorType: "employee" });
    const response = await fetch(`${url}/delivery/calculate`, {
      headers: {
        authorization: header,
        "x-actor-id": "spoofed-actor-id",
        "x-actor-type": "system",
        "x-request-id": "req-123",
      },
    });

    expect(await response.json()).toMatchObject({ actorId, actorType: "employee", requestId: "req-123" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("treats an invalid token on a public path as anonymous", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/delivery/calculate`, {
      headers: { authorization: "Bearer not-a-jwt", "x-actor-id": "spoofed-actor-id" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ actorId: null, actorType: null });
  });

  it("refuses a token that requires a password change", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/orders`, {
      headers: { authorization: await employeeToken({ passwordChangeRequired: true }) },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "password_change_required" });
  });

  it("still refuses a non-public request with no verified token or secret", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/orders`, {
      headers: { "x-actor-id": actorId, "x-actor-type": "system" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "trusted_request_required" });
  });

  it("hands the verified roles of an employee to the route handlers, Platform Admin included", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const header = await employeeToken({ roles: ["Platform Admin"], siteIds: [] });
    const response = await fetch(`${url}/delivery/calculate`, {
      headers: { authorization: header, "x-actor-roles": "Pharmacist" },
    });

    expect(await response.json()).toMatchObject({ roles: "Platform Admin" });
  });

  it("drops client-sent roles on a request with no verified token", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/delivery/calculate`, {
      headers: { "x-actor-roles": "Platform Admin" },
    });

    expect(await response.json()).toMatchObject({ roles: null });
  });

  it("keeps the roles a service forwards with a valid service secret and no token", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/delivery/calculate`, {
      headers: { "x-internal-service-secret": serviceSecret, "x-actor-roles": "Pharmacist" },
    });

    expect(await response.json()).toMatchObject({ roles: "Pharmacist" });
  });

  it("refuses a Warehouse Staff member the orders list, which is a Pharmacist or Pharmacy Manager read", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const header = await employeeToken({ roles: ["Warehouse Staff"] });
    const response = await fetch(`${url}/orders`, { headers: { authorization: header } });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("lets a Pharmacist move an order and refuses a Warehouse Staff member the same move", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const pharmacist = await employeeToken({ roles: ["Pharmacist"] });
    const allowed = await fetch(`${url}/orders/00000000-0000-4000-8000-0000000000bb/transition`, {
      method: "POST",
      headers: { authorization: pharmacist, "content-type": "application/json" },
      body: "{}",
    });
    expect(allowed.status).toBe(200);

    const warehouse = await employeeToken({ roles: ["Warehouse Staff"] });
    const refused = await fetch(`${url}/orders/00000000-0000-4000-8000-0000000000bb/transition`, {
      method: "POST",
      headers: { authorization: warehouse, "content-type": "application/json" },
      body: "{}",
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("refuses Platform Admin the order register, the prescription register and every order or counter write", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const admin = await employeeToken({ roles: ["Platform Admin"], siteIds: [] });
    const headers = { authorization: admin, "content-type": "application/json" };
    const transition = await fetch(`${url}/orders/33333333-3333-4333-8333-333333333333/transition`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(transition.status).toBe(403);
    expect(await transition.json()).toMatchObject({ code: "role_forbidden" });
    // Orders and prescriptions hold customers' names, phones, addresses and medicines: not the administrator's to read.
    for (const path of ["/orders", "/prescriptions", "/counter-transactions"]) {
      const read = await fetch(`${url}${path}`, { headers });
      expect(read.status, path).toBe(403);
      expect(await read.json()).toMatchObject({ code: "role_forbidden" });
    }
  });

  it("refuses Platform Admin a counter write, which only a Pharmacist may make", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const admin = await employeeToken({ roles: ["Platform Admin"], siteIds: [] });
    const response = await fetch(`${url}/prescriptions`, {
      method: "POST",
      headers: { authorization: admin, "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("lets only a Pharmacy Manager write a sales target, never a Pharmacist or Platform Admin", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const write = async (roles: string[]) =>
      fetch(`${url}/sales-targets`, {
        method: "PUT",
        headers: {
          authorization: await employeeToken({ roles }),
          "content-type": "application/json",
        },
        body: "{}",
      });

    expect((await write(["Pharmacy Manager"])).status).toBe(200);
    expect((await write(["Pharmacist"])).status).toBe(403);
    expect((await write(["Platform Admin"])).status).toBe(403);
  });

  it("lets a shopper post a consultation, which carries no staff role", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const customer = await employeeToken({ actorType: "customer", roles: [], siteIds: [] });
    const response = await fetch(`${url}/prescriptions/consultations`, {
      method: "POST",
      headers: { authorization: customer, "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).not.toBe(403);
  });
});
