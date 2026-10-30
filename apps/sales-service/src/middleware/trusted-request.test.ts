import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InternalIdentityContext } from "../contracts/common.ts";

import { createTrustedRequestMiddleware, matchesPathPrefix, signInternalIdentityContext } from "./trusted-request.ts";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../logger.ts", () => ({ createLogger: () => ({ warn }) }));

const identitySecret = "test-identity-secret-1234567890123456";
const serviceSecret = "test-service-secret-1234567890123456";
const actorId = "00000000-0000-4000-8000-000000000001";
const siteId = "00000000-0000-4000-8000-000000000010";

const createTestContext = (overrides: Partial<InternalIdentityContext> = {}): InternalIdentityContext => ({
  version: "v1",
  requestId: "req-123",
  correlationId: "corr-123",
  actorId,
  actorType: "employee",
  roles: ["Pharmacist"],
  siteIds: [siteId],
  issuedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  audience: "sales-service",
  ...overrides,
});

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
      identitySecret,
      serviceSecret,
      expectedAudience: "sales-service",
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

  it("drops client-sent actor headers on a public request with no verified context or secret", async () => {
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

  it("drops client-sent actor headers on a health route with no verified context or secret", async () => {
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

  it("overwrites spoofed actor headers with the values of a verified context", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const header = signInternalIdentityContext(createTestContext({ actorType: "employee" }), identitySecret);
    const response = await fetch(`${url}/delivery/calculate`, {
      headers: {
        "x-internal-identity-context": header,
        "x-actor-id": "spoofed-actor-id",
        "x-actor-type": "system",
      },
    });

    expect(await response.json()).toMatchObject({ actorId, actorType: "employee", requestId: "req-123" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("removes the actor id from a verified context that names no actor", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const header = signInternalIdentityContext(
      createTestContext({ actorId: undefined, actorType: "system" }),
      identitySecret,
    );
    const response = await fetch(`${url}/delivery/calculate`, {
      headers: { "x-internal-identity-context": header, "x-actor-id": "spoofed-actor-id" },
    });

    expect(await response.json()).toMatchObject({ actorId: null, actorType: "system" });
  });

  it("passes an anonymous verified context through as anonymous, with no actor id", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const header = signInternalIdentityContext(
      createTestContext({ actorId: undefined, actorType: "anonymous", roles: [], siteIds: [] }),
      identitySecret,
    );
    const response = await fetch(`${url}/delivery/calculate`, {
      headers: { "x-internal-identity-context": header, "x-actor-id": "spoofed-actor-id" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ actorId: null, actorType: "anonymous" });
  });

  it("still refuses a non-public request with no verified context or secret", async () => {
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

    const header = signInternalIdentityContext(
      createTestContext({ roles: ["Platform Admin"], siteIds: [] }),
      identitySecret,
    );
    const response = await fetch(`${url}/delivery/calculate`, {
      headers: { "x-internal-identity-context": header, "x-actor-roles": "Pharmacist" },
    });

    expect(await response.json()).toMatchObject({ roles: "Platform Admin" });
  });

  it("drops client-sent roles on a request with no verified context", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/delivery/calculate`, {
      headers: { "x-actor-roles": "Platform Admin" },
    });

    expect(await response.json()).toMatchObject({ roles: null });
  });

  it("keeps the roles a service forwards with a valid service secret and no identity context", async () => {
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

    const header = signInternalIdentityContext(createTestContext({ roles: ["Warehouse Staff"] }), identitySecret);
    const response = await fetch(`${url}/orders`, { headers: { "x-internal-identity-context": header } });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("lets a Pharmacist move an order and refuses a Warehouse Staff member the same move", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const pharmacist = signInternalIdentityContext(createTestContext({ roles: ["Pharmacist"] }), identitySecret);
    const allowed = await fetch(`${url}/orders/00000000-0000-4000-8000-0000000000bb/transition`, {
      method: "POST",
      headers: { "x-internal-identity-context": pharmacist, "content-type": "application/json" },
      body: "{}",
    });
    expect(allowed.status).toBe(200);

    const warehouse = signInternalIdentityContext(createTestContext({ roles: ["Warehouse Staff"] }), identitySecret);
    const refused = await fetch(`${url}/orders/00000000-0000-4000-8000-0000000000bb/transition`, {
      method: "POST",
      headers: { "x-internal-identity-context": warehouse, "content-type": "application/json" },
      body: "{}",
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("lets Platform Admin read the order register and refuses it every order or counter write", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const admin = signInternalIdentityContext(
      createTestContext({ roles: ["Platform Admin"], siteIds: [] }),
      identitySecret,
    );
    const headers = { "x-internal-identity-context": admin, "content-type": "application/json" };
    const transition = await fetch(`${url}/orders/33333333-3333-4333-8333-333333333333/transition`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(transition.status).toBe(403);
    expect(await transition.json()).toMatchObject({ code: "role_forbidden" });
    const read = await fetch(`${url}/orders`, { headers });
    expect(read.status).not.toBe(403);
  });

  it("refuses Platform Admin a counter write, which only a Pharmacist may make", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const admin = signInternalIdentityContext(
      createTestContext({ roles: ["Platform Admin"], siteIds: [] }),
      identitySecret,
    );
    const response = await fetch(`${url}/prescriptions`, {
      method: "POST",
      headers: { "x-internal-identity-context": admin, "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("lets only a Pharmacy Manager write a sales target, never a Pharmacist or Platform Admin", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const write = (roles: string[]) =>
      fetch(`${url}/sales-targets`, {
        method: "PUT",
        headers: {
          "x-internal-identity-context": signInternalIdentityContext(createTestContext({ roles }), identitySecret),
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

    const customer = signInternalIdentityContext(
      createTestContext({ actorType: "customer", roles: [], siteIds: [] }),
      identitySecret,
    );
    const response = await fetch(`${url}/prescriptions/consultations`, {
      method: "POST",
      headers: { "x-internal-identity-context": customer, "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).not.toBe(403);
  });
});
