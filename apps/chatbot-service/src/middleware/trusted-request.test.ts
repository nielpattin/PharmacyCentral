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

  it("sets the actor headers from a valid token and overwrites what the client sent", async () => {
    const app = express();
    let seen: Record<string, string | undefined> = {};
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.get("/chatbot/sessions", (req, res) => {
      seen = { actorId: req.header("x-actor-id"), actorType: req.header("x-actor-type") };
      res.json({ ok: true });
    });
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/chatbot/sessions`, {
      headers: {
        ...(await bearerHeaders({ actorId: "00000000-0000-4000-8000-000000000001", actorType: "customer" })),
        "x-actor-id": spoofedActorId,
        "x-actor-type": "employee",
      },
    });
    expect(response.status).toBe(200);
    expect(seen).toEqual({ actorId: "00000000-0000-4000-8000-000000000001", actorType: "customer" });
  });

  it("refuses an expired token", async () => {
    const app = express();
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.get("/chatbot/sessions", (_req, res) => res.json({ ok: true }));
    const { server, url } = await startServer(app);
    activeServer = server;

    const headers = await bearerHeaders(
      { actorId: "00000000-0000-4000-8000-000000000001", actorType: "customer" },
      new Date(Date.now() - 2 * 86_400_000),
    );
    expect((await fetch(`${url}/chatbot/sessions`, { headers })).status).toBe(401);
  });

  it("refuses a token whose account must change its password", async () => {
    const app = express();
    app.use(createTrustedRequestMiddleware({ verifier: testVerifier, serviceSecret }));
    app.get("/chatbot/sessions", (_req, res) => res.json({ ok: true }));
    const { server, url } = await startServer(app);
    activeServer = server;

    const headers = await bearerHeaders({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      passwordChangeRequired: true,
    });
    const response = await fetch(`${url}/chatbot/sessions`, { headers });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "password_change_required" });
  });
});
