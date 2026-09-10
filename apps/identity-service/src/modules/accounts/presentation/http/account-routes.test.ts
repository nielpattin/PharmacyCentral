import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type { AccountService } from "../../application/account-service.ts";

import { createAccountRouter } from "./account-routes.ts";

const startServer = async (app: express.Express): Promise<{ server: Server; url: string }> => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server failed to bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

describe("account csrf route", () => {
  let activeServer: Server | undefined;

  afterEach(
    () =>
      activeServer &&
      new Promise<void>((resolve, reject) => activeServer?.close((error) => (error ? reject(error) : resolve()))),
  );

  it("issues a csrf token and readable cookie without credentials", async () => {
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter({} as unknown as AccountService));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/csrf`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { csrfToken?: unknown };
    expect(typeof body.csrfToken).toBe("string");
    expect((body.csrfToken as string).length).toBeGreaterThan(16);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("pharmacy_csrf=");
    expect(setCookie).not.toContain("HttpOnly");
  });

  it("mints per-service identity contexts for the session", async () => {
    process.env.INTERNAL_IDENTITY_SECRET = "test-identity-secret-1234567890123456";
    const account = {
      id: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: ["Platform Admin"],
      siteIds: [] as string[],
    };
    const stub = { currentSession: async () => ({ account, session: {} }) } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/context`, { headers: { Cookie: "pharmacy_session=valid" } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { contexts?: Record<string, string> };
    expect(Object.keys(body.contexts ?? {}).sort()).toEqual([
      "catalog-service",
      "inventory-service",
      "operations-query-service",
      "payment-service",
      "sales-service",
    ]);
  });

  it("refuses contexts without a session", async () => {
    const stub = { currentSession: async () => undefined } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/context`);
    expect(response.status).toBe(401);
  });
});
