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

/** Mirrors the sales app: `/carts` is public, `/orders` needs a trusted caller, and `/health` is exempt. */
const createApp = (): express.Express => {
  const app = express();
  app.use(
    createTrustedRequestMiddleware({
      identitySecret,
      serviceSecret,
      expectedAudience: "sales-service",
      isPublic: (request) => matchesPathPrefix(request.path, "/carts"),
    }),
  );
  const echoActorHeaders = (request: express.Request, response: express.Response) =>
    response.json({
      actorId: request.header("x-actor-id") ?? null,
      actorType: request.header("x-actor-type") ?? null,
      siteIds: request.header("x-actor-site-ids") ?? null,
      requestId: request.header("x-request-id") ?? null,
    });
  app.all("/carts", echoActorHeaders);
  app.all("/carts/merge", echoActorHeaders);
  app.all("/orders", echoActorHeaders);
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

    const response = await fetch(`${url}/carts`, {
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

    const response = await fetch(`${url}/carts`);

    expect(response.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the actor headers of a request that presents a valid service secret", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const response = await fetch(`${url}/carts`, {
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

    const response = await fetch(`${url}/carts`, {
      headers: { "x-internal-service-secret": serviceSecret },
    });

    expect(await response.json()).toMatchObject({ actorId: null, actorType: "system" });
  });

  it("overwrites spoofed actor headers with the values of a verified context", async () => {
    const { server, url } = await startServer(createApp());
    activeServer = server;

    const header = signInternalIdentityContext(createTestContext({ actorType: "employee" }), identitySecret);
    const response = await fetch(`${url}/carts`, {
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
    const response = await fetch(`${url}/carts`, {
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
    const response = await fetch(`${url}/carts`, {
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
});
