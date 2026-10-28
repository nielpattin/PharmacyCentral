import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import type { AccountService } from "../../application/account-service.ts";
import { AuthRateLimiterError, type AuthRateLimiter } from "../../domain/auth-rate-limit.ts";
import { AccountError } from "../../domain/account-error.ts";

import { noAuditRecorder, type AuditEntry, type AuditRecorder } from "../../../outbox/audit-recorder.ts";
import {
  createAccountRouter as createAccountRouterFor,
  createAdminRouter,
  createCustomerRouter,
  createInternalRouter,
} from "./account-routes.ts";

const startServer = async (app: express.Express): Promise<{ server: Server; url: string }> => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server failed to bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const unlimitedAttempts: AuthRateLimiter = {
  admit: async () => ({ admitted: true, withdraw: async () => undefined }),
};

// The cookie flag is asserted in its own block below; these route tests run with plain-HTTP cookies.
const createAccountRouter = (
  service: AccountService,
  googleSignIn: undefined,
  rateLimiter: AuthRateLimiter,
  audit: AuditRecorder,
) => createAccountRouterFor(service, googleSignIn, rateLimiter, audit, false);

describe("auth cookie Secure attribute", () => {
  const csrfSetCookieFor = async (cookieSecure: boolean): Promise<string> => {
    const app = express();
    app.use(
      "/auth",
      createAccountRouterFor(
        {} as unknown as AccountService,
        undefined,
        unlimitedAttempts,
        noAuditRecorder,
        cookieSecure,
      ),
    );
    const { server, url } = await startServer(app);
    try {
      const response = await fetch(`${url}/auth/csrf`);
      return response.headers.get("set-cookie") ?? "";
    } finally {
      const { promise, resolve } = Promise.withResolvers<void>();
      server.close(() => resolve());
      await promise;
    }
  };

  it("sets Secure on auth cookies only when COOKIE_SECURE is true", async () => {
    expect(await csrfSetCookieFor(true)).toContain("; Secure");
    expect(await csrfSetCookieFor(false)).not.toContain("Secure");
  });

  it("ignores NODE_ENV when deciding Secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(await csrfSetCookieFor(false)).not.toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

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
    app.use(
      "/auth",
      createAccountRouter({} as unknown as AccountService, undefined, unlimitedAttempts, noAuditRecorder),
    );
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
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, noAuditRecorder));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/context`, { headers: { Cookie: "pharmacy_session=valid" } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { contexts?: Record<string, string> };
    expect(Object.keys(body.contexts ?? {}).sort()).toEqual([
      "catalog-service",
      "chatbot-service",
      "inventory-service",
      "operations-query-service",
      "ops-console-service",
      "payment-service",
      "sales-service",
    ]);
  });

  it("refuses contexts without a session", async () => {
    const stub = { currentSession: async () => undefined } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, noAuditRecorder));
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
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, noAuditRecorder));
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
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, noAuditRecorder));
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
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, noAuditRecorder));
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
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, noAuditRecorder));
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

describe("credential attempt limit", () => {
  let activeServer: Server | undefined;

  afterEach(async () => {
    if (!activeServer) return;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    activeServer.close((error) => (error ? reject(error) : resolve()));
    await promise;
  });

  const startAuthServer = async (service: AccountService, limiter: AuthRateLimiter): Promise<string> => {
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(service, undefined, limiter, noAuditRecorder));
    const { server, url } = await startServer(app);
    activeServer = server;
    return url;
  };

  const jsonPost = (url: string, path: string, body: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const credentials = { email: "khach@example.com", password: "mat-khau-dai-12-ky-tu" };

  const refusing = (retryAfterSeconds: number) => ({
    admit: vi.fn(async () => ({ admitted: false as const, retryAfterSeconds })),
  });
  const admitting = (withdraw: () => Promise<void>) => ({
    admit: vi.fn(async () => ({ admitted: true as const, withdraw })),
  });

  it("answers 429 with Retry-After and the error envelope before the password is checked", async () => {
    const login = vi.fn();
    const limiter = refusing(42);
    const url = await startAuthServer({ login } as unknown as AccountService, limiter);

    const response = await jsonPost(url, "/auth/login", credentials);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toEqual({ title: "Too many requests", status: 429, code: "rate_limited" });
    expect(limiter.admit).toHaveBeenCalledWith("login", "khach@example.com", expect.any(String));
    expect(login).not.toHaveBeenCalled();
  });

  it("lets a successful login through under the limit with the unchanged session contract", async () => {
    const account = {
      id: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      email: "khach@example.com",
      displayName: "Khách",
      roles: [] as string[],
      siteIds: [] as string[],
      emailVerifiedAt: new Date(),
    };
    const login = vi.fn(async () => ({ account, session: { rawToken: "raw-session-token" } }));
    const withdraw = vi.fn(async () => undefined);
    const url = await startAuthServer({ login } as unknown as AccountService, admitting(withdraw));

    const response = await jsonPost(url, "/auth/login", credentials);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("pharmacy_session=raw-session-token");
    const body = (await response.json()) as { id: string; email: string; emailVerified: boolean };
    expect(body).toMatchObject({ id: account.id, email: account.email, emailVerified: true });
    expect(login).toHaveBeenCalledTimes(1);
    // A successful sign-in gives its attempt back, so only failed sign-ins spend the budget.
    expect(withdraw).toHaveBeenCalledTimes(1);
  });

  it("does not withdraw a failed sign-in, so the failure keeps its place in the budget", async () => {
    const withdraw = vi.fn(async () => undefined);
    const login = vi.fn(async () => {
      throw new Error("Invalid email or password");
    });
    const url = await startAuthServer({ login } as unknown as AccountService, admitting(withdraw));

    const response = await jsonPost(url, "/auth/login", credentials);
    expect(response.status).toBe(401);
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("still signs a shopper in when the counter cannot withdraw the admitted attempt", async () => {
    const account = {
      id: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      email: "khach@example.com",
      displayName: "Khách",
      roles: [] as string[],
      siteIds: [] as string[],
      emailVerifiedAt: new Date(),
    };
    const login = vi.fn(async () => ({ account, session: { rawToken: "raw-session-token" } }));
    const withdraw = vi.fn(async () => {
      throw new AuthRateLimiterError("Auth rate limiter store is unavailable");
    });
    const url = await startAuthServer({ login } as unknown as AccountService, admitting(withdraw));

    const response = await jsonPost(url, "/auth/login", credentials);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("pharmacy_session=raw-session-token");
  });

  it("answers 503 without checking the password when the counter store is unavailable", async () => {
    const login = vi.fn();
    const limiter: AuthRateLimiter = {
      admit: async () => {
        throw new AuthRateLimiterError("Auth rate limiter store is unavailable");
      },
    };
    const url = await startAuthServer({ login } as unknown as AccountService, limiter);

    const response = await jsonPost(url, "/auth/login", credentials);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      title: "Rate limiter unavailable",
      status: 503,
      code: "rate_limit_unavailable",
    });
    expect(login).not.toHaveBeenCalled();
  });

  it("limits the token routes by account id, not by any address", async () => {
    const accountId = "00000000-0000-4000-8000-000000000009";
    const resetPassword = vi.fn();
    const verifyEmail = vi.fn();
    const limiter = refusing(5);
    const url = await startAuthServer({ resetPassword, verifyEmail } as unknown as AccountService, limiter);

    const reset = await jsonPost(url, "/auth/reset-password", {
      accountId,
      token: "token-guess",
      nextPassword: "mat-khau-moi-12-ky-tu",
    });
    const verify = await fetch(`${url}/auth/verify-email?accountId=${accountId}&token=token-guess`);

    expect(reset.status).toBe(429);
    expect(verify.status).toBe(429);
    expect(limiter.admit).toHaveBeenNthCalledWith(1, "reset-password", accountId, expect.any(String));
    expect(limiter.admit).toHaveBeenNthCalledWith(2, "verify-email", accountId, expect.any(String));
    expect(resetPassword).not.toHaveBeenCalled();
    expect(verifyEmail).not.toHaveBeenCalled();
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
    app.use("/internal", createInternalRouter({ findActiveCustomer } as unknown as AccountService));
    return startServer(app);
  };

  it("resolves an active customer for the system actor", async () => {
    const findActiveCustomer = vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000002",
      displayName: "Nguyễn Thị B",
      phoneNumber: "0901234567",
    });
    const { server, url } = await startInternalServer(findActiveCustomer);
    activeServer = server;

    const response = await fetch(`${url}${customerUrl}`, { headers: systemActor });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "00000000-0000-4000-8000-000000000002",
      displayName: "Nguyễn Thị B",
      phoneNumber: "0901234567",
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

describe("audit entries", () => {
  let activeServer: Server | undefined;
  afterEach(
    () =>
      activeServer &&
      new Promise<void>((resolve, reject) => activeServer?.close((error) => (error ? reject(error) : resolve()))),
  );

  const ids = {
    admin: "00000000-0000-4000-8000-0000000000a1",
    target: "00000000-0000-4000-8000-0000000000b2",
    shopper: "00000000-0000-4000-8000-0000000000c3",
  };
  const account = (id: string, actorType: "employee" | "customer", roles: string[]) => ({
    id,
    actorType,
    email: "x@example.vn",
    displayName: "X",
    roles,
    siteIds: [] as string[],
    isActive: true,
    mustChangePassword: false,
  });

  const start = async (
    service: Partial<Record<keyof AccountService, unknown>>,
  ): Promise<{ url: string; entries: AuditEntry[] }> => {
    const entries: AuditEntry[] = [];
    const audit = { record: (entry: AuditEntry) => (entries.push(entry), Promise.resolve()) };
    const stub = service as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, audit));
    app.use("/admin", createAdminRouter(stub));
    const started = await startServer(app);
    activeServer = started.server;
    return { url: started.url, entries };
  };

  const post = (url: string, path: string, body: unknown = {}) =>
    fetch(url + path, {
      method: "POST",
      headers: { "content-type": "application/json", Cookie: "pharmacy_session=valid" },
      body: JSON.stringify(body),
    });

  it("records an employee sign-in and sign-out under their own id", async () => {
    const employee = account(ids.admin, "employee", ["Pharmacist"]);
    const { url, entries } = await start({
      login: async () => ({ account: employee, session: { rawToken: "t" } }),
      currentSession: async () => ({ account: employee, session: {} }),
      logout: async () => undefined,
    });
    expect((await post(url, "/auth/login", { email: "x@example.vn", password: "a-long-password-1" })).status).toBe(200);
    expect((await post(url, "/auth/logout")).status).toBe(204);
    expect(entries).toEqual([
      { action: "identity.auth.login", entityType: "user", entityId: ids.admin, actorId: ids.admin },
      { action: "identity.auth.logout", entityType: "user", entityId: ids.admin, actorId: ids.admin },
    ]);
  });

  it("does not record a shopper signing in", async () => {
    const shopper = account(ids.shopper, "customer", []);
    const { url, entries } = await start({ login: async () => ({ account: shopper, session: { rawToken: "t" } }) });
    expect((await post(url, "/auth/login", { email: "x@example.vn", password: "a-long-password-1" })).status).toBe(200);
    expect(entries).toEqual([]);
  });

  it("records a failed staff sign-in without the password, naming the account it matched", async () => {
    const refusal = new AccountError(
      403,
      "employee_required",
      "Employee account required",
      "Cần tài khoản nhân viên để vào khu vực này.",
    );
    refusal.reason = "not_employee";
    refusal.accountId = ids.shopper;
    const { url, entries } = await start({
      login: async () => {
        throw refusal;
      },
    });

    const response = await post(url, "/auth/login", {
      email: "x@example.vn",
      password: "a-long-password-1",
      audience: "employee",
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      title: "Employee account required",
      status: 403,
      code: "employee_required",
      detail: "Cần tài khoản nhân viên để vào khu vực này.",
    });
    expect(entries).toEqual([
      {
        action: "identity.auth.login-failed",
        entityType: "user",
        entityId: ids.shopper,
        details: { reason: "not_employee" },
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain("a-long-password-1");
  });

  it("does not record a failed sign-in that did not name a staff sign-in", async () => {
    const { url, entries } = await start({
      login: async () => {
        throw new AccountError(401, "request_failed", "Invalid email or password", "Email hoặc mật khẩu không đúng.");
      },
    });

    expect((await post(url, "/auth/login", { email: "x@example.vn", password: "a-long-password-1" })).status).toBe(401);
    expect(entries).toEqual([]);
  });

  it("refuses a context to an account that must change its password, with the code and detail", async () => {
    const { url } = await start({
      currentSession: async () => ({
        account: { ...account(ids.admin, "employee", ["Pharmacist"]), mustChangePassword: true },
        session: {},
      }),
    });

    const response = await fetch(`${url}/auth/context`, { headers: { Cookie: "pharmacy_session=valid" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      title: "Password change required",
      status: 403,
      code: "password_change_required",
      detail: "Bạn cần đổi mật khẩu trước khi tiếp tục.",
    });
  });
});

describe("administrator routes", () => {
  let activeServer: Server | undefined;
  afterEach(
    () =>
      activeServer &&
      new Promise<void>((resolve, reject) => activeServer?.close((error) => (error ? reject(error) : resolve()))),
  );

  const adminId = "00000000-0000-4000-8000-0000000000a1";
  const targetId = "00000000-0000-4000-8000-0000000000b2";
  const admin = (mustChangePassword: boolean) => ({
    id: adminId,
    actorType: "employee",
    email: "admin@example.vn",
    displayName: "Quản trị",
    roles: ["Platform Admin"],
    siteIds: [] as string[],
    mustChangePassword,
  });

  const start = async (service: Partial<Record<keyof AccountService, unknown>>): Promise<string> => {
    const app = express();
    app.use(express.json());
    app.use("/admin", createAdminRouter(service as unknown as AccountService));
    const started = await startServer(app);
    activeServer = started.server;
    return started.url;
  };

  const session = { Cookie: "pharmacy_session=valid" };

  it("passes the acting administrator to a change and answers 204", async () => {
    const deactivateEmployee = vi.fn(async () => undefined);
    const url = await start({
      currentSession: async () => ({ account: admin(false), session: {} }),
      deactivateEmployee,
    });

    const response = await fetch(`${url}/admin/users/${targetId}/deactivate`, { method: "POST", headers: session });
    expect(response.status).toBe(204);
    expect(deactivateEmployee).toHaveBeenCalledWith(adminId, targetId);
  });

  it("answers a refused change with its code and Vietnamese detail", async () => {
    const url = await start({
      currentSession: async () => ({ account: admin(false), session: {} }),
      deactivateEmployee: async () => {
        throw new AccountError(
          403,
          "self_change_forbidden",
          "An administrator cannot change their own account",
          "Bạn không thể tự vô hiệu hóa tài khoản của mình.",
        );
      },
    });

    const response = await fetch(`${url}/admin/users/${adminId}/deactivate`, { method: "POST", headers: session });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      title: "An administrator cannot change their own account",
      status: 403,
      code: "self_change_forbidden",
      detail: "Bạn không thể tự vô hiệu hóa tài khoản của mình.",
    });
  });

  it("filters the list by status and refuses an unknown status", async () => {
    const listUsers = vi.fn(async () => []);
    const url = await start({ currentSession: async () => ({ account: admin(false), session: {} }), listUsers });

    expect((await fetch(`${url}/admin/users?status=deactivated`, { headers: session })).status).toBe(200);
    expect(listUsers).toHaveBeenCalledWith("deactivated");
    expect((await fetch(`${url}/admin/users?status=bogus`, { headers: session })).status).toBe(400);
  });

  it("refuses every administrator route while the administrator must change their own password", async () => {
    const listUsers = vi.fn();
    const url = await start({ currentSession: async () => ({ account: admin(true), session: {} }), listUsers });

    const response = await fetch(`${url}/admin/users`, { headers: session });
    expect(response.status).toBe(403);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ code: "password_change_required" });
    expect(listUsers).not.toHaveBeenCalled();
  });
});

describe("internal customer batch route", () => {
  let activeServer: Server | undefined;
  afterEach(
    () =>
      activeServer &&
      new Promise<void>((resolve, reject) => activeServer?.close((error) => (error ? reject(error) : resolve()))),
  );

  const customerIds = ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
  const start = async (findActiveCustomers: Mock): Promise<string> => {
    const app = express();
    app.use(express.json());
    app.use("/internal", createInternalRouter({ findActiveCustomers } as unknown as AccountService));
    const started = await startServer(app);
    activeServer = started.server;
    return started.url;
  };

  it("resolves the batch for the system actor", async () => {
    const findActiveCustomers = vi
      .fn()
      .mockResolvedValue([{ id: customerIds[0], displayName: "Nguyễn Thị B", phoneNumber: null }]);
    const url = await start(findActiveCustomers);

    const response = await fetch(`${url}/internal/customers/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-actor-type": "system" },
      body: JSON.stringify({ ids: customerIds }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      customers: [{ id: customerIds[0], displayName: "Nguyễn Thị B", phoneNumber: null }],
    });
    expect(findActiveCustomers).toHaveBeenCalledWith(customerIds);
  });

  it("refuses an empty batch and a malformed id without asking the service", async () => {
    const findActiveCustomers = vi.fn();
    const url = await start(findActiveCustomers);

    for (const body of [{ ids: [] }, { ids: ["not-a-uuid"] }]) {
      const response = await fetch(`${url}/internal/customers/batch`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-actor-type": "system" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(findActiveCustomers).not.toHaveBeenCalled();
  });

  it("refuses a caller that is not the system actor", async () => {
    const findActiveCustomers = vi.fn();
    const url = await start(findActiveCustomers);

    const response = await fetch(`${url}/internal/customers/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-actor-type": "employee" },
      body: JSON.stringify({ ids: customerIds }),
    });
    expect(response.status).toBe(403);
    expect(findActiveCustomers).not.toHaveBeenCalled();
  });
});

describe("staff directory route", () => {
  const siteA = "00000000-0000-4000-8000-0000000000e1";
  const siteB = "00000000-0000-4000-8000-0000000000e2";
  type Viewer = {
    id: string;
    actorType: string;
    email: string;
    displayName: string;
    passwordHash: string;
    roles: string[];
    siteIds: string[];
    isActive: boolean;
    mustChangePassword: boolean;
    createdAt: Date;
  };
  const viewer = (roles: string[], siteIds: string[], mustChangePassword = false): Viewer => ({
    id: "00000000-0000-4000-8000-0000000000f1",
    actorType: "employee",
    email: "quan-ly@example.vn",
    displayName: "Quản lý",
    passwordHash: "hash",
    roles,
    siteIds,
    isActive: true,
    mustChangePassword,
    createdAt: new Date(),
  });

  const startDirectory = async (
    account: Viewer | undefined,
    listActiveEmployees: Mock,
  ): Promise<{ server: Server; url: string }> => {
    const stub = {
      currentSession: async () => (account ? { account, session: {} } : undefined),
      listActiveEmployees,
    } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, noAuditRecorder));
    return startServer(app);
  };

  const close = (server: Server): Promise<void> => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    return promise;
  };

  const sessionCookie = { Cookie: "pharmacy_session=valid" };

  it("lists every active employee for a Platform Admin, with only the name, roles and sites", async () => {
    // The stub answers the contact fields too: the route must still leave them out of the answer.
    const listActiveEmployees = vi.fn().mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-0000000000f2",
        displayName: "Dược sĩ",
        roles: ["Pharmacist"],
        siteIds: [siteA],
        email: "duocsi@example.vn",
        phoneNumber: "0901234567",
      },
    ]);
    const { server, url } = await startDirectory(viewer(["Platform Admin"], []), listActiveEmployees);
    try {
      const response = await fetch(`${url}/auth/staff-directory`, { headers: sessionCookie });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        employees: [
          {
            id: "00000000-0000-4000-8000-0000000000f2",
            displayName: "Dược sĩ",
            roles: ["Pharmacist"],
            siteIds: [siteA],
          },
        ],
      });
      // A Platform Admin is not narrowed to any site.
      expect(listActiveEmployees).toHaveBeenCalledWith(undefined);
    } finally {
      await close(server);
    }
  });

  it("narrows a Pharmacy Manager to the employees sharing the manager's sites", async () => {
    const listActiveEmployees = vi.fn().mockResolvedValue([]);
    const { server, url } = await startDirectory(viewer(["Pharmacy Manager"], [siteA]), listActiveEmployees);
    try {
      const response = await fetch(`${url}/auth/staff-directory`, { headers: sessionCookie });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ employees: [] });
      expect(listActiveEmployees).toHaveBeenCalledWith([siteA]);
    } finally {
      await close(server);
    }
  });

  it("answers a Pharmacy Manager with no site an empty directory", async () => {
    const listActiveEmployees = vi.fn().mockResolvedValue([]);
    const { server, url } = await startDirectory(viewer(["Pharmacy Manager"], [siteA, siteB]), listActiveEmployees);
    try {
      expect((await fetch(`${url}/auth/staff-directory`, { headers: sessionCookie })).status).toBe(200);
      expect(listActiveEmployees).toHaveBeenCalledWith([siteA, siteB]);
    } finally {
      await close(server);
    }

    const noSite = await startDirectory(viewer(["Pharmacy Manager"], []), listActiveEmployees);
    try {
      expect(await (await fetch(`${noSite.url}/auth/staff-directory`, { headers: sessionCookie })).json()).toEqual({
        employees: [],
      });
      expect(listActiveEmployees).toHaveBeenLastCalledWith([]);
    } finally {
      await close(noSite.server);
    }
  });

  it("refuses a Pharmacist, a Warehouse Staff member and a shopper, without reading the directory", async () => {
    const listActiveEmployees = vi.fn();
    const refused = [viewer(["Pharmacist"], [siteA]), viewer(["Warehouse Staff"], [siteA]), viewer([], [])];
    for (const account of refused) {
      const { server, url } = await startDirectory(account, listActiveEmployees);
      try {
        const response = await fetch(`${url}/auth/staff-directory`, { headers: sessionCookie });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "forbidden" });
      } finally {
        await close(server);
      }
    }
    expect(listActiveEmployees).not.toHaveBeenCalled();
  });

  it("refuses a caller with no session", async () => {
    const listActiveEmployees = vi.fn();
    const { server, url } = await startDirectory(undefined, listActiveEmployees);
    try {
      const response = await fetch(`${url}/auth/staff-directory`);
      expect(response.status).toBe(401);
      expect(listActiveEmployees).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it("refuses a Pharmacy Manager who must change the password first", async () => {
    const listActiveEmployees = vi.fn();
    const { server, url } = await startDirectory(viewer(["Pharmacy Manager"], [siteA], true), listActiveEmployees);
    try {
      const response = await fetch(`${url}/auth/staff-directory`, { headers: sessionCookie });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "password_change_required" });
      expect(listActiveEmployees).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });
});

describe("internal employee route", () => {
  let activeServer: Server | undefined;
  afterEach(async () => {
    if (!activeServer) return;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    activeServer.close((error) => (error ? reject(error) : resolve()));
    await promise;
  });

  const systemActor = { "x-actor-type": "system" };
  const employeeId = "00000000-0000-4000-8000-0000000000f2";
  const employeeUrl = `/internal/employees/${employeeId}`;

  const startInternalServer = async (findActiveEmployee: Mock): Promise<string> => {
    const app = express();
    app.use(express.json());
    app.use("/internal", createInternalRouter({ findActiveEmployee } as unknown as AccountService));
    const started = await startServer(app);
    activeServer = started.server;
    return started.url;
  };

  it("resolves an active employee's name, roles and sites for the system actor, never an email", async () => {
    const findActiveEmployee = vi.fn().mockResolvedValue({
      id: employeeId,
      displayName: "Dược sĩ",
      roles: ["Pharmacist"],
      siteIds: ["00000000-0000-4000-8000-0000000000e1"],
      email: "duocsi@example.vn",
    });
    const url = await startInternalServer(findActiveEmployee);

    const response = await fetch(`${url}${employeeUrl}`, { headers: systemActor });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: employeeId,
      displayName: "Dược sĩ",
      roles: ["Pharmacist"],
      siteIds: ["00000000-0000-4000-8000-0000000000e1"],
      isActive: true,
    });
    expect(findActiveEmployee).toHaveBeenCalledWith(employeeId);
  });

  it("answers 404 when the id is not an active employee, so a customer or a deactivated account looks the same", async () => {
    const findActiveEmployee = vi.fn().mockResolvedValue(undefined);
    const url = await startInternalServer(findActiveEmployee);

    const response = await fetch(`${url}${employeeUrl}`, { headers: systemActor });
    expect(response.status).toBe(404);
  });

  it("refuses a caller that is not the system actor", async () => {
    const findActiveEmployee = vi.fn();
    const url = await startInternalServer(findActiveEmployee);

    const response = await fetch(`${url}${employeeUrl}`, { headers: { "x-actor-type": "employee" } });
    expect(response.status).toBe(403);
    expect(findActiveEmployee).not.toHaveBeenCalled();
  });

  it("refuses a malformed id without asking the service", async () => {
    const findActiveEmployee = vi.fn();
    const url = await startInternalServer(findActiveEmployee);

    const response = await fetch(`${url}/internal/employees/not-a-uuid`, { headers: systemActor });
    expect(response.status).toBe(400);
    expect(findActiveEmployee).not.toHaveBeenCalled();
  });
});
