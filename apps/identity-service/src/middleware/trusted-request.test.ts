import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccessTokenInput } from "@pharmacy/auth";

import { createTestAccessTokens, testActorId } from "../test-support/access-tokens.ts";
import {
  ACTOR_SITE_IDS_HEADER,
  IDENTITY_PUBLIC_AUTH_PATHS,
  createTrustedRequestMiddleware,
  findOutOfScopeSiteIds,
  listSiteIds,
  matchesPathPrefix,
  normalizePath,
} from "./trusted-request.ts";

const tokens = await createTestAccessTokens();
const serviceSecret = "test-service-secret-1234567890123456";
const siteA = "00000000-0000-4000-8000-000000000010";
const siteB = "00000000-0000-4000-8000-000000000011";
const outsideSite = "00000000-0000-4000-8000-000000000099";

/** An employee at `siteA` unless the test says otherwise. */
const createTestContext = (overrides: Partial<AccessTokenInput> = {}): Partial<AccessTokenInput> => ({
  siteIds: [siteA],
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
  });

  describe("middleware enforcement", () => {
    it("rejects unauthenticated requests with 401 Problem Details", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
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
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
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
          verifier: tokens.verifier,
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

    it("acts as the system for a valid service secret, whatever actor the caller claims", async () => {
      const app = express();
      let capturedActorType: string | undefined;
      let capturedActorId: string | undefined;
      let capturedRoles: string | undefined;
      let capturedSites: string | undefined;

      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/internal-check", (req, res) => {
        capturedActorType = req.header("x-actor-type") ?? undefined;
        capturedActorId = req.header("x-actor-id") ?? undefined;
        capturedRoles = req.header("x-actor-roles") ?? undefined;
        capturedSites = req.header(ACTOR_SITE_IDS_HEADER) ?? undefined;
        res.json({ ok: true });
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const response = await fetch(`${url}/internal-check`, {
        headers: {
          "x-internal-service-secret": serviceSecret,
          "x-actor-id": "00000000-0000-4000-8000-000000000099",
          "x-actor-type": "employee",
          "x-actor-roles": "Platform Admin",
          [ACTOR_SITE_IDS_HEADER]: siteA,
        },
      });
      expect(response.status).toBe(200);
      expect(capturedActorType).toBe("system");
      expect(capturedActorId).toBeUndefined();
      expect(capturedRoles).toBeUndefined();
      expect(capturedSites).toBeUndefined();
    });

    it("rejects a wrong service secret", async () => {
      const app = express();
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/internal-check", (_req, res) => res.json({ ok: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const response = await fetch(`${url}/internal-check`, {
        headers: { "x-internal-service-secret": "wrong-secret" },
      });
      expect(response.status).toBe(401);
    });

    it("drops client actor headers on a public request without a verified token", async () => {
      const app = express();
      let capturedActorId: string | undefined;
      let capturedActorType: string | undefined;

      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret, isPublic: () => true }));
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

    it("treats a forged, expired or malformed token as anonymous on a public path and refuses it elsewhere", async () => {
      const other = await createTestAccessTokens();
      const expired = await tokens.bearer({}, new Date(Date.now() - 2 * 86_400_000));
      const forged = await other.bearer();
      const app = express();
      let capturedActorId: string | undefined = "unset";
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret, publicPaths: ["/products"] }));
      app.get("/products", (req, res) => {
        capturedActorId = req.header("x-actor-id");
        res.json({ ok: true });
      });
      app.get("/protected", (_req, res) => res.json({ ok: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      for (const authorization of [expired, forged, "Bearer not-a-jwt", "Basic abc"]) {
        capturedActorId = "unset";
        const open = await fetch(`${url}/products`, {
          headers: { authorization, "x-actor-id": "spoofed" },
        });
        expect(open.status).toBe(200);
        expect(capturedActorId).toBeUndefined();

        const closed = await fetch(`${url}/protected`, { headers: { authorization } });
        expect(closed.status).toBe(401);
        expect(await closed.json()).toMatchObject({ code: "trusted_request_required" });
      }
    });

    it("accepts a token a moment before it expires and refuses it after", async () => {
      const app = express();
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/prescriptions", (_req, res) => res.json([]));

      const { server, url } = await startServer(app);
      activeServer = server;

      const issuedAt = new Date(Date.now() - (86_400_000 - 10_000));
      const live = await tokens.bearer({}, issuedAt);
      expect((await fetch(`${url}/prescriptions`, { headers: { authorization: live } })).status).toBe(200);

      const stale = await tokens.bearer({}, new Date(Date.now() - (86_400_000 + 30_000)));
      expect((await fetch(`${url}/prescriptions`, { headers: { authorization: stale } })).status).toBe(401);
    });

    it("derives and overwrites actor headers from the access token, stripping spoofed headers", async () => {
      const app = express();
      let captured: Record<string, string | undefined> = {};

      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/identity-check", (req, res) => {
        captured = {
          actorId: req.header("x-actor-id"),
          actorType: req.header("x-actor-type"),
          roles: req.header("x-actor-roles"),
          sites: req.header(ACTOR_SITE_IDS_HEADER),
          requestId: req.header("x-request-id"),
        };
        res.json({ ok: true });
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const response = await fetch(`${url}/identity-check`, {
        headers: {
          authorization: await tokens.bearer(createTestContext({ roles: ["Pharmacist", "Warehouse Staff"] })),
          "x-actor-id": "spoofed-actor-id",
          "x-actor-type": "system",
          "x-actor-roles": "Platform Admin",
          [ACTOR_SITE_IDS_HEADER]: outsideSite,
          "x-request-id": "req-from-gateway",
        },
      });
      expect(response.status).toBe(200);
      expect(captured).toEqual({
        actorId: testActorId,
        actorType: "employee",
        roles: "Pharmacist,Warehouse Staff",
        sites: siteA,
        requestId: "req-from-gateway",
      });
    });

    it("stamps a request id when the gateway sent none or a malformed one", async () => {
      const app = express();
      let requestId: string | undefined;
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/prescriptions", (req, res) => {
        requestId = req.header("x-request-id");
        res.json([]);
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const authorization = await tokens.bearer();
      await fetch(`${url}/prescriptions`, { headers: { authorization } });
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
      await fetch(`${url}/prescriptions`, { headers: { authorization, "x-request-id": "bad id!" } });
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("gives a shopper no roles header", async () => {
      const app = express();
      let roles: string | undefined = "unset";
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/carts", (req, res) => {
        roles = req.header("x-actor-roles");
        res.json({});
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const authorization = await tokens.bearer({ actorType: "customer", roles: ["Pharmacist"], siteIds: [] });
      await fetch(`${url}/carts`, { headers: { authorization, "x-actor-roles": "Platform Admin" } });
      expect(roles).toBeUndefined();
    });

    describe("password change required", () => {
      const start = async (): Promise<string> => {
        const app = express();
        app.use(
          createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret, publicPaths: ["/auth/login"] }),
        );
        app.use((_req, res) => res.json({ ok: true }));
        const started = await startServer(app);
        activeServer = started.server;
        return started.url;
      };

      it("refuses a pcr token on every route except the auth routes", async () => {
        const url = await start();
        const authorization = await tokens.bearer({ passwordChangeRequired: true });

        for (const path of ["/prescriptions", "/inventory/balances", "/admin/users", "/carts"]) {
          const response = await fetch(`${url}${path}`, { headers: { authorization } });
          expect(response.status).toBe(403);
          expect(await response.json()).toMatchObject({ code: "password_change_required" });
        }
        for (const path of ["/auth/me", "/auth/change-password", "/api/auth/me"]) {
          expect((await fetch(`${url}${path}`, { headers: { authorization } })).status).toBe(200);
        }
      });

      it("admits the same account once its token no longer carries pcr", async () => {
        const url = await start();
        const authorization = await tokens.bearer({ passwordChangeRequired: false });
        expect((await fetch(`${url}/prescriptions`, { headers: { authorization } })).status).toBe(200);
      });
    });

    it("enforces assigned site access on query parameters for non-admin employees", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/inventory/batches", (_req, res) => res.json({ ok: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({
        siteIds: ["00000000-0000-4000-8000-000000000010"],
      });
      const header = await tokens.bearer(employeeContext);

      // Allowed site
      const resAllowed = await fetch(`${url}/inventory/batches?siteId=00000000-0000-4000-8000-000000000010`, {
        headers: { authorization: header },
      });
      expect(resAllowed.status).toBe(200);

      // Denied site
      const resDenied = await fetch(`${url}/inventory/batches?siteId=00000000-0000-4000-8000-000000000099`, {
        headers: { authorization: header },
      });
      expect(resDenied.status).toBe(403);
      const deniedBody = (await resDenied.json()) as { code: string; title: string };
      expect(deniedBody.code).toBe("site_access_denied");
    });

    it("injects the only assigned site into site-scoped list queries", async () => {
      const app = express();
      let capturedSiteId: string | undefined;
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/inventory/balances", (request, response) => {
        capturedSiteId = typeof request.query.siteId === "string" ? request.query.siteId : undefined;
        response.json({ ok: true });
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({
        siteIds: ["00000000-0000-4000-8000-000000000010"],
      });
      const header = await tokens.bearer(employeeContext);
      const response = await fetch(`${url}/inventory/balances?limit=10`, {
        headers: { authorization: header },
      });

      expect(response.status).toBe(200);
      expect(capturedSiteId).toBe("00000000-0000-4000-8000-000000000010");
    });

    it("enforces assigned site access on request body for non-admin employees", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.post("/inventory/transfers", (_req, res) => res.json({ created: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({
        siteIds: ["00000000-0000-4000-8000-000000000010", "00000000-0000-4000-8000-000000000011"],
      });
      const header = await tokens.bearer(employeeContext);

      // Valid body with allowed source and destination
      const resAllowed = await fetch(`${url}/inventory/transfers`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: header,
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
          authorization: header,
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
          authorization: header,
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
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/inventory/balances", (_req, res) => res.json([]));

      const { server, url } = await startServer(app);
      activeServer = server;

      const noSiteContext = createTestContext({ siteIds: [] });
      const header = await tokens.bearer(noSiteContext);

      const response = await fetch(`${url}/inventory/balances`, {
        headers: { authorization: header },
      });
      expect(response.status).toBe(403);
      const body = (await response.json()) as { code: string; title: string };
      expect(body.title).toBe("No site access assigned");
      expect(body.code).toBe("site_access_denied");
    });

    it("allows Platform Admin access regardless of assigned sites", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/inventory/balances", (_req, res) => res.json({ unassignedSite: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const adminContext = createTestContext({
        roles: ["Platform Admin"],
        siteIds: [],
      });
      const header = await tokens.bearer(adminContext);

      const response = await fetch(`${url}/inventory/balances?siteId=00000000-0000-4000-8000-000000000099`, {
        headers: { authorization: header },
      });
      expect(response.status).toBe(200);
    });

    it("prevents response JSON from leaking unauthorized site IDs", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));

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
      const header = await tokens.bearer(employeeContext);

      // Check leaking res.json
      const leakResJson = await fetch(`${url}/leak-check-json`, {
        headers: { authorization: header },
      });
      expect(leakResJson.status).toBe(403);
      const leakJsonBody = (await leakResJson.json()) as { code: string; title: string };
      expect(leakJsonBody.code).toBe("site_access_denied");

      // Check leaking res.send
      const leakResSend = await fetch(`${url}/leak-check-send`, {
        headers: { authorization: header },
      });
      expect(leakResSend.status).toBe(403);
      const leakSendBody = (await leakResSend.json()) as { code: string; title: string };
      expect(leakSendBody.code).toBe("site_access_denied");

      // Check valid response passes through
      const validRes = await fetch(`${url}/valid-response`, {
        headers: { authorization: header },
      });
      expect(validRes.status).toBe(200);
      const validBody = (await validRes.json()) as { id: string; siteId: string };
      expect(validBody.siteId).toBe("00000000-0000-4000-8000-000000000010");
    });

    it("strips a forged actor site header from an unauthenticated public request", async () => {
      const app = express();
      let capturedSiteIds: string[] | undefined;
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret, publicPaths: ["/products"] }));
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

    it("overwrites a forged actor site header with the sites the access token carries", async () => {
      const app = express();
      let capturedSiteIds: string[] | undefined;
      let capturedHeader: string | undefined;
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
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
          authorization: await tokens.bearer(employeeContext),
          [ACTOR_SITE_IDS_HEADER]: outsideSite,
        },
      });

      expect(response.status).toBe(200);
      expect(capturedHeader).toBe(siteA);
      expect(capturedSiteIds).toEqual([siteA]);
    });

    it("reports an empty scope for an employee with no sites on a path that is not site scoped", async () => {
      const app = express();
      let capturedSiteIds: string[] | undefined;
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/prescriptions", (request, response) => {
        capturedSiteIds = listSiteIds(request);
        response.json([]);
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({ siteIds: [] });
      const response = await fetch(`${url}/prescriptions`, {
        headers: { authorization: await tokens.bearer(employeeContext) },
      });

      expect(response.status).toBe(200);
      expect(capturedSiteIds).toEqual([]);
    });

    it("refuses a requested site outside the employee's scope before the handler runs", async () => {
      const app = express();
      const handler = vi.fn((_request: express.Request, response: express.Response) => {
        response.json([]);
      });
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/inventory/balances", handler);

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({ siteIds: [siteA] });
      const response = await fetch(`${url}/inventory/balances?siteId=${outsideSite}`, {
        headers: { authorization: await tokens.bearer(employeeContext) },
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
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/inventory/balances", handler);

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({ siteIds: [siteA, siteB] });
      const response = await fetch(`${url}/inventory/balances?siteId=${siteA}&siteId=${siteB}`, {
        headers: { authorization: await tokens.bearer(employeeContext) },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ title: "Invalid request", status: 400, code: "invalid_request" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("keeps a shopper on their own paths and off the counter's", async () => {
      const app = express();
      app.use(express.json());
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/inventory/balances", (_req, res) => res.json([]));
      app.get("/carts", (_req, res) => res.json({ lines: [] }));
      app.get("/prescriptions", (_req, res) => res.json([]));
      app.post("/prescriptions", (_req, res) => res.json({ created: true }));

      const { server, url } = await startServer(app);
      activeServer = server;

      const shopperContext = createTestContext({ actorType: "customer", roles: [], siteIds: [] });
      const header = await tokens.bearer(shopperContext);

      const staffPath = await fetch(`${url}/inventory/balances`, {
        headers: { authorization: header },
      });
      expect(staffPath.status).toBe(403);
      expect(await staffPath.json()).toMatchObject({
        title: "Employee access required",
        status: 403,
        code: "employee_required",
      });

      const counterWrite = await fetch(`${url}/prescriptions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: header },
        body: JSON.stringify({}),
      });
      expect(counterWrite.status).toBe(403);

      const shopperPath = await fetch(`${url}/carts`, {
        headers: { authorization: header },
      });
      expect(shopperPath.status).toBe(200);

      const sharedRead = await fetch(`${url}/prescriptions`, {
        headers: { authorization: header },
      });
      expect(sharedRead.status).toBe(200);
    });

    it("ignores a shopper's site filter", async () => {
      const app = express();
      let capturedSiteIds: string[] | undefined;
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/prescriptions", (request, response) => {
        capturedSiteIds = listSiteIds(request);
        response.json([]);
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const shopperContext = createTestContext({ actorType: "customer", roles: [], siteIds: [] });
      const response = await fetch(`${url}/prescriptions?siteId=${outsideSite}`, {
        headers: { authorization: await tokens.bearer(shopperContext) },
      });

      expect(response.status).toBe(200);
      expect(capturedSiteIds).toBeUndefined();
    });

    it("lets a scoped employee read a transfer that touches their site and refuses one that does not", async () => {
      const app = express();
      const ownTransfer = [{ id: "transfer-1", sourceSiteId: siteA, destinationSiteId: siteB }];
      const foreignTransfer = [{ id: "transfer-2", sourceSiteId: siteB, destinationSiteId: outsideSite }];
      app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
      app.get("/inventory/transfers", (_request, response) => {
        response.json(ownTransfer);
      });
      app.get("/inventory/transfer-log", (_request, response) => {
        response.json(foreignTransfer);
      });

      const { server, url } = await startServer(app);
      activeServer = server;

      const employeeContext = createTestContext({ siteIds: [siteA] });
      const header = await tokens.bearer(employeeContext);

      const visible = await fetch(`${url}/inventory/transfers`, {
        headers: { authorization: header },
      });
      expect(visible.status).toBe(200);
      const visibleRows = (await visible.json()) as Array<{ id: string }>;
      expect(visibleRows.map((row) => row.id)).toEqual(["transfer-1"]);

      const hidden = await fetch(`${url}/inventory/transfer-log`, {
        headers: { authorization: header },
      });
      expect(hidden.status).toBe(403);
      const hiddenBody = (await hidden.json()) as { code: string };
      expect(hiddenBody.code).toBe("site_access_denied");
    });
  });
});

describe("identity public auth paths", () => {
  it("leaves the credential and key-set routes open and puts the bearer routes behind a token", () => {
    for (const path of [
      "/auth/login",
      "/auth/request-password-reset",
      "/auth/reset-password",
      "/.well-known/jwks.json",
    ]) {
      expect(IDENTITY_PUBLIC_AUTH_PATHS).toContain(path);
    }
    for (const path of ["/auth/me", "/auth/staff-directory", "/auth/change-password"]) {
      expect(IDENTITY_PUBLIC_AUTH_PATHS).not.toContain(path);
    }
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

  // A request the middleware admits reaches the fallback (200); a refused one never does.
  const callAs = async (roles: string[], path: string): Promise<Response> => {
    const app = express();
    app.use(createTrustedRequestMiddleware({ verifier: tokens.verifier, serviceSecret }));
    app.use((_request, response) => response.json({ ok: true }));
    const { server, url } = await startServer(app);
    activeServer = server;
    const context = createTestContext({ roles });
    return fetch(`${url}${path}`, {
      headers: { authorization: await tokens.bearer(context) },
    });
  };

  it("refuses a Pharmacy Manager the admin routes, which only Platform Admin reads", async () => {
    const refused = await callAs(["Pharmacy Manager"], "/admin/users");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "role_forbidden" });
    expect((await callAs(["Platform Admin"], "/admin/users")).status).toBe(200);
  });

  it("lets a Pharmacist look up a customer, and refuses a Pharmacy Manager the same lookup", async () => {
    expect((await callAs(["Pharmacist"], "/customers/00000000-0000-4000-8000-000000000060")).status).toBe(200);
    expect((await callAs(["Pharmacy Manager"], "/customers/00000000-0000-4000-8000-000000000060")).status).toBe(403);
  });

  it("lets a Pharmacy Manager read the staff directory, and refuses Platform Admin and the other staff roles", async () => {
    expect((await callAs(["Pharmacy Manager"], "/auth/staff-directory")).status).toBe(200);
    expect((await callAs(["Platform Admin"], "/auth/staff-directory")).status).toBe(403);
    // Customer accounts are the counter's: the administrator manages staff accounts, not shoppers.
    expect((await callAs(["Platform Admin"], "/customers/lookup")).status).toBe(403);
    const refused = await callAs(["Pharmacist"], "/auth/staff-directory");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "role_forbidden" });
    expect((await callAs(["Warehouse Staff"], "/auth/staff-directory")).status).toBe(403);
  });
});
