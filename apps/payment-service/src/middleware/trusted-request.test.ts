import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type { InternalIdentityContext } from "../contracts/common.ts";

import { createTrustedRequestMiddleware, signInternalIdentityContext } from "./trusted-request.ts";

const identitySecret = "test-identity-secret-1234567890123456";
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

  it("drops client actor headers on a public request without a verified context", async () => {
    const app = express();
    let capturedActorId: string | undefined;
    let capturedActorType: string | undefined;

    app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret, isPublic: () => true }));
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

  it("refuses a non-public request that carries actor headers but no verified context", async () => {
    const app = express();
    app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
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

  // Mirrors the employee and shopper cases of policy.mjs. A request the middleware admits reaches the fallback (200).
  const callAs = async (
    actorType: "employee" | "customer",
    roles: string[],
    path: string,
    method: string,
  ): Promise<Response> => {
    const app = express();
    app.use(express.json());
    app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
    app.use((_request, response) => response.json({ ok: true }));
    const { server, url } = await startServer(app);
    activeServer = server;
    const context: InternalIdentityContext = {
      version: "v1",
      requestId: "req-role",
      correlationId: "corr-role",
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType,
      roles,
      siteIds: ["00000000-0000-4000-8000-000000000010"],
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      audience: "payment-service",
    };
    return fetch(`${url}${path}`, {
      method,
      headers: {
        "x-internal-identity-context": signInternalIdentityContext(context, identitySecret),
        "content-type": "application/json",
      },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
  };

  const paymentId = "/payments/00000000-0000-4000-8000-000000000030";

  it("admits a Pharmacy Manager and a Pharmacist to a refund, and refuses Warehouse Staff", async () => {
    expect((await callAs("employee", ["Pharmacy Manager"], `${paymentId}/refund`, "POST")).status).toBe(200);
    expect((await callAs("employee", ["Pharmacist"], `${paymentId}/refund`, "POST")).status).toBe(200);
    const refused = await callAs("employee", ["Warehouse Staff"], `${paymentId}/refund`, "POST");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("refuses Platform Admin every money write, and lets it read the payment register", async () => {
    for (const path of [`${paymentId}/refund`, `${paymentId}/confirm-counter`, "/payments/prescriptions/123"]) {
      const response = await callAs("employee", ["Platform Admin"], path, "POST");
      expect(response.status, path).toBe(403);
      expect(await response.json()).toMatchObject({ code: "role_forbidden" });
    }
    expect((await callAs("employee", ["Platform Admin"], "/payments/invoices", "GET")).status).toBe(200);
  });

  it("refuses a Pharmacy Manager confirming counter cash, which only a Pharmacist may do", async () => {
    const response = await callAs("employee", ["Pharmacy Manager"], `${paymentId}/confirm-counter`, "POST");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden" });
  });

  it("lets a shopper create an invoice, which carries no staff role", async () => {
    const response = await callAs("customer", [], "/payments/invoices", "POST");
    expect(response.status).toBe(200);
  });
});
