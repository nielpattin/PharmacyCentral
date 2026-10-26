import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { InternalIdentityContext } from "../contracts/common.ts";

import {
  ACTOR_SITE_IDS_HEADER,
  IDENTITY_PUBLIC_AUTH_PATHS,
  createTrustedRequestMiddleware,
  findOutOfScopeSiteIds,
  listSiteIds,
  matchesPathPrefix,
  normalizePath,
  signInternalIdentityContext,
  verifyInternalIdentityContext,
} from "./trusted-request.ts";

const identitySecret = "test-identity-secret-1234567890123456";
const serviceSecret = "test-service-secret-1234567890123456";
const siteA = "00000000-0000-4000-8000-000000000010";
const siteB = "00000000-0000-4000-8000-000000000011";
const outsideSite = "00000000-0000-4000-8000-000000000099";

const createTestContext = (overrides: Partial<InternalIdentityContext> = {}): InternalIdentityContext => ({
  version: "v1",
  requestId: "req-123",
  correlationId: "corr-123",
  actorId: "00000000-0000-4000-8000-000000000001",
  actorType: "employee",
  roles: ["Pharmacist"],
  siteIds: ["00000000-0000-4000-8000-000000000010"],
  issuedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  audience: "catalog-service",
  ...overrides,
});

const startServer = async (app: express.Express): Promise<{ server: Server; url: string }> => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server failed to bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
};

describe("service-request-enforcement", () => {
  let activeServer: Server | undefined;

  afterEach(async () => {
    if (activeServer) {
      await closeServer(activeServer);
      activeServer = undefined;
    }
  });

  describe("utilities", () => {
    it("normalizes paths correctly", () => {
      expect(normalizePath("foo")).toBe("/foo");
      expect(normalizePath("/foo/bar?q=1")).toBe("/foo/bar");
      expect(normalizePath("")).toBe("/");
    });

    it("matches path prefixes with and without /api", () => {
      expect(matchesPathPrefix("/inventory/balances", "/inventory/balances")).toBe(true);
      expect(matchesPathPrefix("/inventory/balances/123", "/inventory/balances")).toBe(true);
      expect(matchesPathPrefix("/api/inventory/balances", "/inventory/balances")).toBe(true);
      expect(matchesPathPrefix("/inventory/balances", "/api/inventory/balances")).toBe(true);
      expect(matchesPathPrefix("/inventory/other", "/inventory/balances")).toBe(false);
    });

    it("reports the site IDs a payload names outside the caller's scope", () => {
      const payload = {
        siteId: "site-1",
        meta: {
          sourceSiteId: "site-2",
          items: [{ destinationSiteId: "site-3" }, { other: 123 }, { siteId: "site-1" }],
        },
      };
      expect(findOutOfScopeSiteIds(payload, ["site-1"]).sort()).toEqual(["site-2", "site-3"].sort());
      expect(findOutOfScopeSiteIds(payload, ["site-1", "site-2", "site-3"])).toEqual([]);
      expect(findOutOfScopeSiteIds(null, [])).toEqual([]);
      expect(findOutOfScopeSiteIds("not an object", [])).toEqual([]);
    });

    it("treats a transfer as in scope when either of its sites is", () => {
      const transfer = { id: "transfer-1", sourceSiteId: "site-1", destinationSiteId: "site-2" };

      expect(findOutOfScopeSiteIds(transfer, ["site-1"])).toEqual([]);
      expect(findOutOfScopeSiteIds(transfer, ["site-2"])).toEqual([]);
      expect(findOutOfScopeSiteIds([transfer], ["site-2"])).toEqual([]);
      expect(findOutOfScopeSiteIds(transfer, ["site-9"]).sort()).toEqual(["site-1", "site-2"]);
      // A row that names only one site is still judged on that site alone.
      expect(findOutOfScopeSiteIds({ destinationSiteId: "site-2" }, ["site-1"])).toEqual(["site-2"]);
    });

    it("signs and verifies internal identity context", () => {
      const context = createTestContext();
      const signed = signInternalIdentityContext(context, identitySecret);
      const verified = verifyInternalIdentityContext(signed, identitySecret);
      expect(verified).toEqual(context);

      // Audience binding checks
      expect(verifyInternalIdentityContext(signed, identitySecret, new Date(), "catalog-service")).toEqual(context);
      expect(
        verifyInternalIdentityContext(signed, identitySecret, new Date(), ["inventory-service", "catalog-service"]),
      ).toEqual(context);
      expect(verifyInternalIdentityContext(signed, identitySecret, new Date(), "inventory-service")).toBeUndefined();
      expect(
        verifyInternalIdentityContext(signed, identitySecret, new Date(), ["inventory-service", "sales-service"]),
      ).toBeUndefined();

      expect(verifyInternalIdentityContext(signed, "wrong-secret")).toBeUndefined();

      const expiredContext = createTestContext({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const expiredSigned = signInternalIdentityContext(expiredContext, identitySecret);
      expect(verifyInternalIdentityContext(expiredSigned, identitySecret)).toBeUndefined();
    });
  });

  describe("middleware enforcement", () => {
    it("rejects signed contexts with mismatched audience", async () => {
      const app = express();
      app.use(express.json());
      app.use(
        createTrustedRequestMiddleware({
          identitySecret,
          serviceSecret,
          expectedAudience: "catalog-service",
        }),
      );
      app.get("/items", (_req, res) => res.json({ ok: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      // Context targeted at inventory-service should be rejected by catalog-service
      const inventoryContext = createTestContext({ audience: "inventory-service" });
      const header = signInternalIdentityContext(inventoryContext, identitySecret);

      const response = await fetch(`${url}/items`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(response.status).toBe(401);
      const body = (await response.json()) as { code: string; title: string };
      expect(body.code).toBe("trusted_request_required");
      expect(body.title).toBe("Trusted gateway request required");
    });

    it("accepts signed contexts with matching expectedAudience", async () => {
      const app = express();
      app.use(express.json());
      app.use(
        createTrustedRequestMiddleware({
          identitySecret,
          serviceSecret,
          expectedAudience: "catalog-service",
        }),
      );
      app.get("/items", (_req, res) => res.json({ ok: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const matchingContext = createTestContext({ audience: "catalog-service" });
      const header = signInternalIdentityContext(matchingContext, identitySecret);

      const response = await fetch(`${url}/items`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });

    it("rejects unauthenticated requests with 401 Problem Details", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/items", (_req, res) => res.json({ ok: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const response = await fetch(`${url}/items`);
      expect(response.status).toBe(401);
      const body = (await response.json()) as { code: string; title: string };
      expect(body.code).toBe("trusted_request_required");
      expect(body.title).toBe("Trusted gateway request required");
    });

    it("allows health checks without credentials", async () => {
      const app = express();
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/health/ready", (_req, res) => res.json({ status: "ok" }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const response = await fetch(`${url}/health/ready`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe("ok");
    });

    it("allows configured public paths", async () => {
      const app = express();
      app.use(
        createTrustedRequestMiddleware({
          identitySecret,
          serviceSecret,
          publicPaths: ["/auth/login", "/auth/register"],
        }),
      );
      app.post("/auth/login", (_req, res) => res.json({ loggedIn: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const response = await fetch(`${url}/auth/login`, { method: "POST" });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { loggedIn: boolean };
      expect(body.loggedIn).toBe(true);
    });

    it("accepts valid internal service secret", async () => {
      const app = express();
      let capturedActorType: string | undefined;
      let capturedActorId: string | undefined;

      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/internal-check", (req, res) => {
        capturedActorType = req.header("x-actor-type") ?? undefined;
        capturedActorId = req.header("x-actor-id") ?? undefined;
        res.json({ ok: true });
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const response = await fetch(`${url}/internal-check`, {
        headers: {
          "x-internal-service-secret": serviceSecret,
          "x-actor-id": "00000000-0000-4000-8000-000000000099",
        },
      });
      expect(response.status).toBe(200);
      expect(capturedActorType).toBe("system");
      expect(capturedActorId).toBe("00000000-0000-4000-8000-000000000099");
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
        headers: {
          "x-actor-id": "00000000-0000-4000-8000-000000000099",
          "x-actor-type": "employee",
        },
      });
      expect(response.status).toBe(200);
      expect(capturedActorId).toBeUndefined();
      expect(capturedActorType).toBeUndefined();
    });

    it("derives and overwrites actor headers from signed context, stripping spoofed headers", async () => {
      const app = express();
      let capturedActorId: string | undefined;
      let capturedActorType: string | undefined;
      let capturedRequestId: string | undefined;

      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/identity-check", (req, res) => {
        capturedActorId = req.header("x-actor-id") ?? undefined;
        capturedActorType = req.header("x-actor-type") ?? undefined;
        capturedRequestId = req.header("x-request-id") ?? undefined;
        res.json({ ok: true });
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      // Case 1: valid actor ID
      const context1 = createTestContext({
        actorId: "00000000-0000-4000-8000-000000000001",
        actorType: "employee",
        requestId: "req-verified-1",
      });
      const header1 = signInternalIdentityContext(context1, identitySecret);

      const res1 = await fetch(`${url}/identity-check`, {
        headers: {
          "x-internal-identity-context": header1,
          "x-actor-id": "spoofed-actor-id",
        },
      });
      expect(res1.status).toBe(200);
      expect(capturedActorId).toBe("00000000-0000-4000-8000-000000000001");
      expect(capturedActorType).toBe("employee");
      expect(capturedRequestId).toBe("req-verified-1");

      // Case 2: no actor ID in context (should strip client-sent x-actor-id)
      const context2 = createTestContext({
        actorId: undefined,
        actorType: "system",
      });
      const header2 = signInternalIdentityContext(context2, identitySecret);

      const res2 = await fetch(`${url}/identity-check`, {
        headers: {
          "x-internal-identity-context": header2,
          "x-actor-id": "spoofed-actor-id",
        },
      });
      expect(res2.status).toBe(200);
      expect(capturedActorId).toBeUndefined();
      expect(capturedActorType).toBe("system");
    });

    it("enforces assigned site access on query parameters for non-admin employees", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/inventory/batches", (_req, res) => res.json({ ok: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({
        siteIds: ["00000000-0000-4000-8000-000000000010"],
      });
      const header = signInternalIdentityContext(employeeContext, identitySecret);

      // Allowed site
      const resAllowed = await fetch(`${url}/inventory/batches?siteId=00000000-0000-4000-8000-000000000010`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(resAllowed.status).toBe(200);

      // Denied site
      const resDenied = await fetch(`${url}/inventory/batches?siteId=00000000-0000-4000-8000-000000000099`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(resDenied.status).toBe(403);
      const deniedBody = (await resDenied.json()) as { code: string; title: string };
      expect(deniedBody.code).toBe("site_access_denied");
    });

    it("injects the only assigned site into site-scoped list queries", async () => {
      const app = express();
      let capturedSiteId: string | undefined;
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/inventory/balances", (request, response) => {
        capturedSiteId = typeof request.query.siteId === "string" ? request.query.siteId : undefined;
        response.json({ ok: true });
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({
        siteIds: ["00000000-0000-4000-8000-000000000010"],
      });
      const header = signInternalIdentityContext(employeeContext, identitySecret);
      const response = await fetch(`${url}/inventory/balances?limit=10`, {
        headers: { "x-internal-identity-context": header },
      });

      expect(response.status).toBe(200);
      expect(capturedSiteId).toBe("00000000-0000-4000-8000-000000000010");
    });

    it("enforces assigned site access on request body for non-admin employees", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.post("/inventory/transfers", (_req, res) => res.json({ created: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({
        siteIds: ["00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"],
      });
      const header = signInternalIdentityContext(employeeContext, identitySecret);

      // Valid body with allowed source and destination
      const resAllowed = await fetch(`${url}/inventory/transfers`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-identity-context": header,
        },
        body: JSON.stringify({
          sourceSiteId: "00000000-0000-4000-8000-000000000010",
          destinationSiteId: "00000000-0000-4000-8000-000000000011",
        }),
      });
      expect(resAllowed.status).toBe(200);

      // A transfer belongs to either end's scope, so a source the employee holds is enough to send it out.
      const resCrossSite = await fetch(`${url}/inventory/transfers`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-identity-context": header,
        },
        body: JSON.stringify({
          sourceSiteId: "00000000-0000-4000-8000-000000000010",
          destinationSiteId: "00000000-0000-4000-8000-000000000099",
        }),
      });
      expect(resCrossSite.status).toBe(200);

      // A transfer with neither end among the assigned sites is refused.
      const resDenied = await fetch(`${url}/inventory/transfers`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-identity-context": header,
        },
        body: JSON.stringify({
          sourceSiteId: "00000000-0000-4000-8000-000000000098",
          destinationSiteId: "00000000-0000-4000-8000-000000000099",
        }),
      });
      expect(resDenied.status).toBe(403);
    });

    it("rejects site-scoped list route access when employee has no sites assigned", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/inventory/balances", (_req, res) => res.json([]));

      const { server, url } = await startServer(app);
      activeServer = server;

      const noSiteContext = createTestContext({ siteIds: [] });
      const header = signInternalIdentityContext(noSiteContext, identitySecret);

      const response = await fetch(`${url}/inventory/balances`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(response.status).toBe(403);
      const body = (await response.json()) as { code: string; title: string };
      expect(body.title).toBe("No site access assigned");
      expect(body.code).toBe("site_access_denied");
    });

    it("allows Platform Admin access regardless of assigned sites", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/inventory/balances", (_req, res) => res.json({ unassignedSite: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const adminContext = createTestContext({
        roles: ["Platform Admin"],
        siteIds: [],
      });
      const header = signInternalIdentityContext(adminContext, identitySecret);

      const response = await fetch(`${url}/inventory/balances?siteId=00000000-0000-4000-8000-000000000099`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(response.status).toBe(200);
    });

    it("prevents response JSON from leaking unauthorized site IDs", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));

      app.get("/leak-check-json", (_req, res) => {
        res.json({
          id: "rec-1",
          siteId: "00000000-0000-4000-8000-000000000099",
          secretData: "sensitive",
        });
      });

      app.get("/leak-check-send", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.send(JSON.stringify([{ id: "row-1", destinationSiteId: "00000000-0000-4000-8000-000000000099" }]));
      });

      app.get("/valid-response", (_req, res) => {
        res.json({
          id: "rec-1",
          siteId: "00000000-0000-4000-8000-000000000010",
        });
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({
        siteIds: ["00000000-0000-4000-8000-000000000010"],
      });
      const header = signInternalIdentityContext(employeeContext, identitySecret);

      // Check leaking res.json
      const leakResJson = await fetch(`${url}/leak-check-json`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(leakResJson.status).toBe(403);
      const leakJsonBody = (await leakResJson.json()) as { code: string; title: string };
      expect(leakJsonBody.code).toBe("site_access_denied");

      // Check leaking res.send
      const leakResSend = await fetch(`${url}/leak-check-send`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(leakResSend.status).toBe(403);
      const leakSendBody = (await leakResSend.json()) as { code: string; title: string };
      expect(leakSendBody.code).toBe("site_access_denied");

      // Check valid response passes through
      const validRes = await fetch(`${url}/valid-response`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(validRes.status).toBe(200);
      const validBody = (await validRes.json()) as { id: string; siteId: string };
      expect(validBody.siteId).toBe("00000000-0000-4000-8000-000000000010");
    });

    it("strips a forged actor site header from an unauthenticated public request", async () => {
      const app = express();
      let capturedSiteIds: string[] | undefined;
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret, publicPaths: ["/products"] }));
      app.get("/products", (request, response) => {
        capturedSiteIds = listSiteIds(request);
        response.json({ ok: true, actorSites: request.header(ACTOR_SITE_IDS_HEADER) ?? null });
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const response = await fetch(`${url}/products`, {
        headers: { [ACTOR_SITE_IDS_HEADER]: outsideSite },
      });

      expect(response.status).toBe(200);
      const publicBody = (await response.json()) as { actorSites: string | null };
      expect(publicBody.actorSites).toBeNull();
      expect(capturedSiteIds).toBeUndefined();
    });

    it("overwrites a forged actor site header with the sites the signed context carries", async () => {
      const app = express();
      let capturedSiteIds: string[] | undefined;
      let capturedHeader: string | undefined;
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/inventory/balances", (request, response) => {
        capturedSiteIds = listSiteIds(request);
        capturedHeader = request.header(ACTOR_SITE_IDS_HEADER);
        response.json({ ok: true });
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({ siteIds: [siteA] });
      const response = await fetch(`${url}/inventory/balances`, {
        headers: {
          "x-internal-identity-context": signInternalIdentityContext(employeeContext, identitySecret),
          [ACTOR_SITE_IDS_HEADER]: outsideSite,
        },
      });

      expect(response.status).toBe(200);
      expect(capturedHeader).toBe(siteA);
      expect(capturedSiteIds).toEqual([siteA]);
    });

    it("honours the actor site header an internal service forwards", async () => {
      const app = express();
      let capturedSiteIds: string[] | undefined;
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/reports/stock", (request, response) => {
        capturedSiteIds = listSiteIds(request);
        response.json({ ok: true });
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const response = await fetch(`${url}/reports/stock`, {
        headers: {
          "x-internal-service-secret": serviceSecret,
          "x-actor-type": "employee",
          [ACTOR_SITE_IDS_HEADER]: `${siteA},${siteB}`,
        },
      });

      expect(response.status).toBe(200);
      expect(capturedSiteIds).toEqual([siteA, siteB]);
    });

    it("reports an empty scope for an employee with no sites on a path that is not site scoped", async () => {
      const app = express();
      let capturedSiteIds: string[] | undefined;
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/prescriptions", (request, response) => {
        capturedSiteIds = listSiteIds(request);
        response.json([]);
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({ siteIds: [] });
      const response = await fetch(`${url}/prescriptions`, {
        headers: { "x-internal-identity-context": signInternalIdentityContext(employeeContext, identitySecret) },
      });

      expect(response.status).toBe(200);
      expect(capturedSiteIds).toEqual([]);
    });

    it("refuses a requested site outside the employee's scope before the handler runs", async () => {
      const app = express();
      const handler = vi.fn((_request: express.Request, response: express.Response) => {
        response.json([]);
      });
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/inventory/balances", handler);

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({ siteIds: [siteA] });
      const response = await fetch(`${url}/inventory/balances?siteId=${outsideSite}`, {
        headers: { "x-internal-identity-context": signInternalIdentityContext(employeeContext, identitySecret) },
      });

      expect(response.status).toBe(403);
      const deniedBody = (await response.json()) as { code: string };
      expect(deniedBody.code).toBe("site_access_denied");
      expect(handler).not.toHaveBeenCalled();
    });

    it("refuses a repeated site query rather than reading it unfiltered", async () => {
      const app = express();
      const handler = vi.fn((_request: express.Request, response: express.Response) => {
        response.json([]);
      });
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/inventory/balances", handler);

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({ siteIds: [siteA, siteB] });
      const response = await fetch(`${url}/inventory/balances?siteId=${siteA}&siteId=${siteB}`, {
        headers: { "x-internal-identity-context": signInternalIdentityContext(employeeContext, identitySecret) },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ title: "Invalid request", status: 400, code: "invalid_request" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("keeps a shopper on their own paths and off the counter's", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/inventory/balances", (_req, res) => res.json([]));
      app.get("/carts", (_req, res) => res.json({ lines: [] }));
      app.get("/prescriptions", (_req, res) => res.json([]));
      app.post("/prescriptions", (_req, res) => res.json({ created: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const shopperContext = createTestContext({ actorType: "customer", roles: [], siteIds: [] });
      const header = signInternalIdentityContext(shopperContext, identitySecret);

      const staffPath = await fetch(`${url}/inventory/balances`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(staffPath.status).toBe(403);
      expect(await staffPath.json()).toMatchObject({
        title: "Employee access required",
        status: 403,
        code: "employee_required",
      });

      const counterWrite = await fetch(`${url}/prescriptions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-identity-context": header },
        body: JSON.stringify({}),
      });
      expect(counterWrite.status).toBe(403);

      const shopperPath = await fetch(`${url}/carts`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(shopperPath.status).toBe(200);

      const sharedRead = await fetch(`${url}/prescriptions`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(sharedRead.status).toBe(200);
    });

    it("ignores a shopper's site filter", async () => {
      const app = express();
      let capturedSiteIds: string[] | undefined;
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/prescriptions", (request, response) => {
        capturedSiteIds = listSiteIds(request);
        response.json([]);
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const shopperContext = createTestContext({ actorType: "customer", roles: [], siteIds: [] });
      const response = await fetch(`${url}/prescriptions?siteId=${outsideSite}`, {
        headers: { "x-internal-identity-context": signInternalIdentityContext(shopperContext, identitySecret) },
      });

      expect(response.status).toBe(200);
      expect(capturedSiteIds).toBeUndefined();
    });

    it("lets a scoped employee read a transfer that touches their site and refuses one that does not", async () => {
      const app = express();
      const ownTransfer = [{ id: "transfer-1", sourceSiteId: siteA, destinationSiteId: siteB }];
      const foreignTransfer = [{ id: "transfer-2", sourceSiteId: siteB, destinationSiteId: outsideSite }];
      app.use(createTrustedRequestMiddleware({ identitySecret, serviceSecret }));
      app.get("/inventory/transfers", (_request, response) => {
        response.json(ownTransfer);
      });
      app.get("/inventory/transfer-log", (_request, response) => {
        response.json(foreignTransfer);
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({ siteIds: [siteA] });
      const header = signInternalIdentityContext(employeeContext, identitySecret);

      const visible = await fetch(`${url}/inventory/transfers`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(visible.status).toBe(200);
      const visibleRows = (await visible.json()) as Array<{ id: string }>;
      expect(visibleRows.map((row) => row.id)).toEqual(["transfer-1"]);

      const hidden = await fetch(`${url}/inventory/transfer-log`, {
        headers: { "x-internal-identity-context": header },
      });
      expect(hidden.status).toBe(403);
      const hiddenBody = (await hidden.json()) as { code: string };
      expect(hiddenBody.code).toBe("site_access_denied");
    });
  });
});

describe("identity browser session paths", () => {
  it("exempts cookie-authenticated browser routes from gateway checks", () => {
    for (const path of [
      "/auth/csrf",
      "/auth/context",
      "/auth/me",
      "/auth/logout",
      "/auth/change-password",
      "/auth/request-password-reset",
      "/auth/reset-password",
    ]) {
      expect(IDENTITY_PUBLIC_AUTH_PATHS).toContain(path);
    }
  });
});
