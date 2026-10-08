import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import type { AccountService } from "../../application/account-service.ts";

import { createAccountRouter, createCustomerRouter, createInternalCustomerRouter } from "./account-routes.ts";

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

  it("updates the signed-in shopper's own display name and phone", async () => {
    const account = {
      id: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      email: "khach@example.com",
      displayName: "Cũ",
      passwordHash: "hash",
      roles: [] as string[],
      siteIds: [] as string[],
      createdAt: new Date(),
    };
    const updateProfile = vi.fn(
      async (accountId: string, input: { displayName?: string; phoneNumber?: string | null }) => {
        expect(accountId).toBe(account.id);
        return {
          ...account,
          displayName: input.displayName ?? account.displayName,
          phoneNumber: input.phoneNumber ?? undefined,
        };
      },
    );
    const stub = { currentSession: async () => ({ account, session: {} }), updateProfile } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: "pharmacy_session=valid" },
      body: JSON.stringify({ displayName: "Nguyễn Thị B", phoneNumber: "0901234567" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { displayName: string; phoneNumber: string | null };
    expect(body.displayName).toBe("Nguyễn Thị B");
    expect(body.phoneNumber).toBe("0901234567");
    // The session identity owns the profile: the route must address the signed-in account, not a body-supplied id.
    expect(updateProfile.mock.calls[0]?.[0]).toBe(account.id);
  });

  it("keeps an omitted field untouched when patching the profile", async () => {
    const account = {
      id: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      email: "khach@example.com",
      displayName: "Giữ nguyên",
      phoneNumber: "0909999999",
      passwordHash: "hash",
      roles: [] as string[],
      siteIds: [] as string[],
      createdAt: new Date(),
    };
    const updateProfile = vi.fn(async (_accountId: string, input: { displayName?: string }) => ({
      ...account,
      displayName: input.displayName ?? account.displayName,
    }));
    const stub = { currentSession: async () => ({ account, session: {} }), updateProfile } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: "pharmacy_session=valid" },
      body: JSON.stringify({ displayName: "Tên mới" }),
    });
    expect(response.status).toBe(200);
    // An omitted key must stay absent from the update so the stored phone is not blanked by a name-only edit.
    expect(Object.keys(updateProfile.mock.calls[0]?.[1] ?? {})).toEqual(["displayName"]);
    const body = (await response.json()) as { phoneNumber: string | null };
    expect(body.phoneNumber).toBe("0909999999");
  });

  it("rejects a profile patch from a caller with no session", async () => {
    const updateProfile = vi.fn();
    const stub = { currentSession: async () => undefined, updateProfile } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Không cần phiên" }),
    });
    expect(response.status).toBe(401);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("rejects a phone number that is not a dialable string", async () => {
    const account = {
      id: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      email: "khach@example.com",
      displayName: "Tên",
      passwordHash: "hash",
      roles: [] as string[],
      siteIds: [] as string[],
      createdAt: new Date(),
    };
    const updateProfile = vi.fn();
    const stub = { currentSession: async () => ({ account, session: {} }), updateProfile } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: "pharmacy_session=valid" },
      body: JSON.stringify({ phoneNumber: "gọi tôi sau" }),
    });
    expect(response.status).toBe(400);
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

describe("customer lookup route", () => {
  let activeServer: Server | undefined;

  afterEach(
    () =>
      activeServer &&
      new Promise<void>((resolve, reject) => activeServer?.close((error) => (error ? reject(error) : resolve()))),
  );

  const employee = (roles: string[]) => ({
    id: "00000000-0000-4000-8000-000000000001",
    actorType: "employee",
    email: "duocsi@example.com",
    displayName: "Dược sĩ",
    passwordHash: "hash",
    roles,
    siteIds: [] as string[],
    createdAt: new Date(),
  });

  const sessionCookie = { Cookie: "pharmacy_session=valid" };

  const startLookupServer = async (
    account: { roles: string[] } | undefined,
    searchCustomers: Mock,
  ): Promise<{ server: Server; url: string }> => {
    const stub = {
      currentSession: async () => (account ? { account, session: {} } : undefined),
      searchCustomers,
    } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/customers", createCustomerRouter(stub));
    return startServer(app);
  };

  it("returns the four customer fields for a Pharmacist search", async () => {
    const searchCustomers = vi.fn().mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000002",
        displayName: "Nguyễn Thị B",
        email: "khach@example.com",
        phoneNumber: "0901234567",
      },
    ]);
    const { server, url } = await startLookupServer(employee(["Pharmacist"]), searchCustomers);
    activeServer = server;

    const lookupUrl = `${url}/customers/lookup?q=${encodeURIComponent("  khach@example.com  ")}`;
    const response = await fetch(lookupUrl, { headers: sessionCookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000002",
        displayName: "Nguyễn Thị B",
        email: "khach@example.com",
        phoneNumber: "0901234567",
      },
    ]);
    // The route trims the query before it reaches the search, and never widens the answer with roles or hashes.
    expect(searchCustomers).toHaveBeenCalledWith("khach@example.com");
  });

  it("refuses a warehouse employee", async () => {
    const searchCustomers = vi.fn().mockResolvedValue([]);
    const { server, url } = await startLookupServer(employee(["Warehouse Staff"]), searchCustomers);
    activeServer = server;

    const response = await fetch(`${url}/customers/lookup?q=khach@example.com`, { headers: sessionCookie });
    expect(response.status).toBe(403);
    expect(searchCustomers).not.toHaveBeenCalled();
  });

  it("refuses a lookup without a session", async () => {
    const searchCustomers = vi.fn().mockResolvedValue([]);
    const { server, url } = await startLookupServer(undefined, searchCustomers);
    activeServer = server;

    const response = await fetch(`${url}/customers/lookup?q=khach@example.com`);
    expect(response.status).toBe(401);
    expect(searchCustomers).not.toHaveBeenCalled();
  });

  it("refuses a query shorter than three characters", async () => {
    const searchCustomers = vi.fn().mockResolvedValue([]);
    const { server, url } = await startLookupServer(employee(["Pharmacist"]), searchCustomers);
    activeServer = server;

    const response = await fetch(`${url}/customers/lookup?q=ab`, { headers: sessionCookie });
    expect(response.status).toBe(400);
    expect(searchCustomers).not.toHaveBeenCalled();
  });
});

describe("internal customer route", () => {
  let activeServer: Server | undefined;

  afterEach(
    () =>
      activeServer &&
      new Promise<void>((resolve, reject) => activeServer?.close((error) => (error ? reject(error) : resolve()))),
  );

  const systemActor = { "x-actor-type": "system" };
  const customerUrl = "/internal/customers/00000000-0000-4000-8000-000000000002";

  const startInternalServer = async (findActiveCustomer: Mock): Promise<{ server: Server; url: string }> => {
    const app = express();
    app.use(express.json());
    app.use("/internal", createInternalCustomerRouter({ findActiveCustomer } as unknown as AccountService));
    return startServer(app);
  };

  it("resolves an active customer for the system actor", async () => {
    const findActiveCustomer = vi
      .fn()
      .mockResolvedValue({ id: "00000000-0000-4000-8000-000000000002", displayName: "Nguyễn Thị B" });
    const { server, url } = await startInternalServer(findActiveCustomer);
    activeServer = server;

    const response = await fetch(`${url}${customerUrl}`, { headers: systemActor });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "00000000-0000-4000-8000-000000000002",
      displayName: "Nguyễn Thị B",
    });
  });

  it("answers 404 for an account that is not an active customer", async () => {
    const findActiveCustomer = vi.fn().mockResolvedValue(undefined);
    const { server, url } = await startInternalServer(findActiveCustomer);
    activeServer = server;

    const response = await fetch(`${url}${customerUrl}`, { headers: systemActor });
    expect(response.status).toBe(404);
  });

  it("refuses a caller that is not the system actor", async () => {
    const findActiveCustomer = vi.fn().mockResolvedValue({ id: "x", displayName: "Khách" });
    const { server, url } = await startInternalServer(findActiveCustomer);
    activeServer = server;

    const response = await fetch(`${url}${customerUrl}`, { headers: { "x-actor-type": "employee" } });
    expect(response.status).toBe(403);
    expect(findActiveCustomer).not.toHaveBeenCalled();
  });
});
