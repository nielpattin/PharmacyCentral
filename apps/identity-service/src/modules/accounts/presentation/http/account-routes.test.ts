import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import type { AccountService } from "../../application/account-service.ts";
import { AuthRateLimiterError, type AuthRateLimiter } from "../../domain/auth-rate-limit.ts";
import { AccountError } from "../../domain/account-error.ts";
import type { GoogleSignIn } from "../../infrastructure/security/google-oidc-client.ts";

import { noAuditRecorder, type AuditEntry, type AuditRecorder } from "../../../outbox/audit-recorder.ts";
import { createTestAccessTokens } from "../../../../test-support/access-tokens.ts";
import { createTrustedRequestMiddleware, IDENTITY_PUBLIC_AUTH_PATHS } from "../../../../middleware/trusted-request.ts";
import { createJwksRouter } from "./jwks-routes.ts";
import {
  createAccountRouter as createAccountRouterFor,
  createAdminRouter,
  createCustomerRouter,
  createInternalRouter,
} from "./account-routes.ts";

const tokens = await createTestAccessTokens();

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

const createAccountRouter = (
  service: AccountService,
  googleSignIn: GoogleSignIn | undefined,
  rateLimiter: AuthRateLimiter,
  audit: AuditRecorder,
) => createAccountRouterFor(service, googleSignIn, rateLimiter, audit, tokens.signer);

describe("account routes", () => {
  let activeServer: Server | undefined;

  afterEach(
    () =>
      activeServer &&
      new Promise<void>((resolve, reject) => activeServer?.close((error) => (error ? reject(error) : resolve()))),
  );

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
    const stub = { findActiveAccount: async () => account, updateProfile } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, noAuditRecorder));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-actor-id": "00000000-0000-4000-8000-000000000001" },
      body: JSON.stringify({ displayName: "Nguyễn Thị B", phoneNumber: "0901234567" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { displayName: string; phoneNumber: string | null };
    expect(body.displayName).toBe("Nguyễn Thị B");
    expect(body.phoneNumber).toBe("0901234567");
    // The token identity owns the profile: the route must address the signed-in account, not a body-supplied id.
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
    const stub = { findActiveAccount: async () => account, updateProfile } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, noAuditRecorder));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-actor-id": "00000000-0000-4000-8000-000000000001" },
      body: JSON.stringify({ displayName: "Tên mới" }),
    });
    expect(response.status).toBe(200);
    // An omitted key must stay absent from the update so the stored phone is not blanked by a name-only edit.
    expect(Object.keys(updateProfile.mock.calls[0]?.[1] ?? {})).toEqual(["displayName"]);
    const body = (await response.json()) as { phoneNumber: string | null };
    expect(body.phoneNumber).toBe("0909999999");
  });

  it("rejects a profile patch from a caller with no identity", async () => {
    const updateProfile = vi.fn();
    const stub = { findActiveAccount: async () => undefined, updateProfile } as unknown as AccountService;
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
    const stub = { findActiveAccount: async () => account, updateProfile } as unknown as AccountService;
    const app = express();
    app.use(express.json());
    app.use("/auth", createAccountRouter(stub, undefined, unlimitedAttempts, noAuditRecorder));
    const { server, url } = await startServer(app);
    activeServer = server;

    const response = await fetch(`${url}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-actor-id": "00000000-0000-4000-8000-000000000001" },
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

  it("lets a successful login through under the limit with a token and no cookie", async () => {
    const account = {
      id: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      email: "khach@example.com",
      displayName: "Khách",
      roles: [] as string[],
      siteIds: [] as string[],
      emailVerifiedAt: new Date(),
    };
    const login = vi.fn(async () => account);
    const withdraw = vi.fn(async () => undefined);
    const url = await startAuthServer({ login } as unknown as AccountService, admitting(withdraw));

    const response = await jsonPost(url, "/auth/login", credentials);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = (await response.json()) as { id: string; email: string; emailVerified: boolean; accessToken: string };
    expect(body).toMatchObject({ id: account.id, email: account.email, emailVerified: true });
    expect(typeof body.accessToken).toBe("string");
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
    const login = vi.fn(async () => account);
    const withdraw = vi.fn(async () => {
      throw new AuthRateLimiterError("Auth rate limiter store is unavailable");
    });
    const url = await startAuthServer({ login } as unknown as AccountService, admitting(withdraw));

    const response = await jsonPost(url, "/auth/login", credentials);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
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

  const sessionCookie = { "x-actor-id": "00000000-0000-4000-8000-000000000001" };

  const startLookupServer = async (
    account: { roles: string[] } | undefined,
    searchCustomers: Mock,
  ): Promise<{ server: Server; url: string }> => {
    const stub = {
      findActiveAccount: async () => account,
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

  it("refuses a lookup without an identity", async () => {
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

  it("records an employee sign-in under their own id", async () => {
    const employee = account(ids.admin, "employee", ["Pharmacist"]);
    const { url, entries } = await start({
      login: async () => employee,
    });
    expect((await post(url, "/auth/login", { email: "x@example.vn", password: "a-long-password-1" })).status).toBe(200);
    expect(entries).toEqual([
      { action: "identity.auth.login", entityType: "user", entityId: ids.admin, actorId: ids.admin },
    ]);
  });

  it("does not record a shopper signing in", async () => {
    const shopper = account(ids.shopper, "customer", []);
    const { url, entries } = await start({
      login: async () => shopper,
    });
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

  const session = { "x-actor-id": adminId };

  it("passes the acting administrator to a change and answers 204", async () => {
    const deactivateEmployee = vi.fn(async () => undefined);
    const url = await start({
      findActiveAccount: async () => admin(false),
      deactivateEmployee,
    });

    const response = await fetch(`${url}/admin/users/${targetId}/deactivate`, { method: "POST", headers: session });
    expect(response.status).toBe(204);
    expect(deactivateEmployee).toHaveBeenCalledWith(adminId, targetId);
  });

  it("answers a refused change with its code and Vietnamese detail", async () => {
    const url = await start({
      findActiveAccount: async () => admin(false),
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

  it("refuses a new employee without a valid phone before the service runs", async () => {
    const createEmployee = vi.fn(async () => ({ ...admin(false), id: targetId, phoneNumber: "0901234567" }));
    const url = await start({ findActiveAccount: async () => admin(false), createEmployee });
    const body = {
      email: "new@example.vn",
      password: "a-long-enough-password",
      displayName: "Mới",
      roles: ["Pharmacist"],
      siteIds: [targetId],
    };
    const post = (extra: Record<string, unknown>) =>
      fetch(`${url}/admin/users`, {
        method: "POST",
        headers: { ...session, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, ...extra }),
      });

    expect((await post({})).status).toBe(400);
    expect((await post({ phoneNumber: "" })).status).toBe(400);
    expect((await post({ phoneNumber: "abc" })).status).toBe(400);
    expect(createEmployee).not.toHaveBeenCalled();
    const created = await post({ phoneNumber: "0901234567" });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { phoneNumber: string }).phoneNumber).toBe("0901234567");
  });

  it("passes the acting administrator and a valid name and phone to a profile correction", async () => {
    const updateEmployeeProfile = vi.fn(async () => ({ ...admin(false), id: targetId, phoneNumber: "0912345678" }));
    const url = await start({
      findActiveAccount: async () => admin(false),
      updateEmployeeProfile,
    });
    const put = (body: Record<string, unknown>) =>
      fetch(`${url}/admin/users/${targetId}/profile`, {
        method: "PUT",
        headers: { ...session, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await put({ displayName: "Mới" })).status).toBe(400);
    expect((await put({ displayName: "Mới", phoneNumber: "abc" })).status).toBe(400);
    expect(updateEmployeeProfile).not.toHaveBeenCalled();
    expect((await put({ displayName: "Mới", phoneNumber: "0912345678" })).status).toBe(200);
    expect(updateEmployeeProfile).toHaveBeenCalledWith(adminId, targetId, {
      displayName: "Mới",
      phoneNumber: "0912345678",
    });
  });

  it("filters the list by status and refuses an unknown status", async () => {
    const listUsers = vi.fn(async () => []);
    const url = await start({ findActiveAccount: async () => admin(false), listUsers });

    expect((await fetch(`${url}/admin/users?status=deactivated`, { headers: session })).status).toBe(200);
    expect(listUsers).toHaveBeenCalledWith("deactivated");
    expect((await fetch(`${url}/admin/users?status=bogus`, { headers: session })).status).toBe(400);
  });

  it("refuses every administrator route while the administrator must change their own password", async () => {
    const listUsers = vi.fn();
    const url = await start({ findActiveAccount: async () => admin(true), listUsers });

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
      findActiveAccount: async () => account,
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

  const sessionCookie = { "x-actor-id": "00000000-0000-4000-8000-000000000001" };

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

  it("refuses a caller with no identity", async () => {
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

  it("lists the active employees at one site for the system actor, never an email", async () => {
    const siteId = "00000000-0000-4000-8000-0000000000e1";
    const listActiveEmployees = vi
      .fn()
      .mockResolvedValue([
        { id: employeeId, displayName: "Dược sĩ", roles: ["Pharmacist"], siteIds: [siteId], email: "a@example.vn" },
      ]);
    const app = express();
    app.use("/internal", createInternalRouter({ listActiveEmployees } as unknown as AccountService));
    const started = await startServer(app);
    activeServer = started.server;

    const response = await fetch(`${started.url}/internal/employees?siteId=${siteId}`, { headers: systemActor });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      employees: [{ id: employeeId, displayName: "Dược sĩ", roles: ["Pharmacist"], siteIds: [siteId] }],
    });
    expect(listActiveEmployees).toHaveBeenCalledWith([siteId]);

    const employeeCaller = await fetch(`${started.url}/internal/employees?siteId=${siteId}`, {
      headers: { "x-actor-type": "employee" },
    });
    expect(employeeCaller.status).toBe(403);
    const malformed = await fetch(`${started.url}/internal/employees?siteId=nope`, { headers: systemActor });
    expect(malformed.status).toBe(400);
  });
});

describe("access tokens", () => {
  let activeServer: Server | undefined;
  afterEach(async () => {
    if (!activeServer) return;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    activeServer.close((error) => (error ? reject(error) : resolve()));
    activeServer = undefined;
    await promise;
  });

  const accountId = "00000000-0000-4000-8000-000000000001";
  const siteId = "00000000-0000-4000-8000-0000000000e1";
  const account = (overrides: Record<string, unknown> = {}) => ({
    id: accountId,
    actorType: "employee",
    email: "duocsi@example.vn",
    displayName: "Dược sĩ",
    roles: ["Pharmacist"],
    siteIds: [siteId],
    isActive: true,
    mustChangePassword: false,
    emailVerifiedAt: new Date(),
    ...overrides,
  });
  const appUrl = "https://app.example.vn";
  const googleRedirectUri = "http://localhost:3001/auth/google/callback";

  /** The routes as main.ts wires them: trusted-request, then the routers. */
  const start = async (
    service: Partial<Record<keyof AccountService, unknown>>,
    googleSignIn?: GoogleSignIn,
  ): Promise<string> => {
    const app = express();
    app.use(express.json());
    app.use(
      createTrustedRequestMiddleware({
        verifier: tokens.verifier,
        serviceSecret: "service-secret",
        publicPaths: [...IDENTITY_PUBLIC_AUTH_PATHS],
      }),
    );
    app.use(createJwksRouter(tokens.signer));
    app.use(
      "/auth",
      createAccountRouterFor(
        service as unknown as AccountService,
        googleSignIn,
        unlimitedAttempts,
        noAuditRecorder,
        tokens.signer,
      ),
    );
    app.use("/admin", createAdminRouter(service as unknown as AccountService));
    const started = await startServer(app);
    activeServer = started.server;
    return started.url;
  };

  const claims = async (token: string) => {
    const identity = await tokens.verifier.verify(token);
    if (!identity) throw new Error("token did not verify");
    return identity;
  };

  const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("issues a one-day access token and no cookie on login", async () => {
    const url = await start({ login: async () => account() });

    const response = await fetch(url + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "duocsi@example.vn", password: "a-long-password-1" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { accessToken: string; accessTokenExpiresAt: string; id: string };
    expect(body.id).toBe(accountId);
    const identity = await claims(body.accessToken);
    expect(identity).toMatchObject({
      actorId: accountId,
      actorType: "employee",
      roles: ["Pharmacist"],
      siteIds: [siteId],
      passwordChangeRequired: false,
    });
    expect(identity.expiresAt - identity.issuedAt).toBe(86_400);
    expect(new Date(body.accessTokenExpiresAt).getTime()).toBe(identity.expiresAt * 1000);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("carries pcr on the token of an account that must change its password", async () => {
    const url = await start({ login: async () => account({ mustChangePassword: true }) });
    const response = await fetch(url + "/auth/login", {
      method: "POST",
      ...json({ email: "duocsi@example.vn", password: "a-long-password-1" }),
    });
    const body = (await response.json()) as { accessToken: string; passwordChangeRequired: boolean };
    expect(body.passwordChangeRequired).toBe(true);
    expect((await claims(body.accessToken)).passwordChangeRequired).toBe(true);
  });

  it("issues an access token when the first administrator is set up", async () => {
    const url = await start({
      createFirstAdmin: async () => account({ roles: ["Platform Admin"], siteIds: [] }),
    });
    const response = await fetch(url + "/auth/setup-admin", {
      method: "POST",
      ...json({ email: "admin@example.vn", password: "a-long-password-1", displayName: "Quản trị" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { accessToken: string };
    expect((await claims(body.accessToken)).roles).toEqual(["Platform Admin"]);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  describe("change password", () => {
    it("returns a fresh token with pcr cleared", async () => {
      const changePassword = vi.fn(async () => account({ mustChangePassword: false }));
      const url = await start({
        findActiveAccount: async () => account({ mustChangePassword: true }),
        changePassword,
      });

      const response = await fetch(url + "/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: await tokens.bearer({ actorId: accountId, passwordChangeRequired: true }),
        },
        body: JSON.stringify({ currentPassword: "mat-khau-tam-thoi", nextPassword: "mat-khau-moi-12-ky-tu" }),
      });
      expect(response.status).toBe(200);
      expect(changePassword).toHaveBeenCalledWith(accountId, "mat-khau-tam-thoi", "mat-khau-moi-12-ky-tu");
      const body = (await response.json()) as { accessToken: string; passwordChangeRequired: boolean };
      expect(body.passwordChangeRequired).toBe(false);
      expect((await claims(body.accessToken)).passwordChangeRequired).toBe(false);
      expect(response.headers.get("set-cookie")).toBeNull();
    });
  });

  describe("google callback", () => {
    const googleSignIn = (): GoogleSignIn =>
      ({
        client: {
          completeAuthorization: async () => ({ subject: "g-1", email: "khach@example.com", displayName: "Khách" }),
        },
        redirectUri: googleRedirectUri,
        appUrl,
      }) as unknown as GoogleSignIn;

    it("redirects to the web app with the access token in the URL fragment and clears the state cookie", async () => {
      const url = await start(
        { loginWithGoogle: async () => account({ actorType: "customer", roles: [], siteIds: [] }) },
        googleSignIn(),
      );

      const response = await fetch(url + "/auth/google/callback?state=abc&code=xyz", {
        redirect: "manual",
        headers: { Cookie: "oauth_state=abc" },
      });
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.origin + location.pathname).toBe(`${appUrl}/auth/callback`);
      expect(location.search).toBe("");
      const token = new URLSearchParams(location.hash.slice(1)).get("access_token");
      expect(token).toBeTruthy();
      expect(await claims(token ?? "")).toMatchObject({ actorId: accountId, actorType: "customer", roles: [] });
      const cookies = response.headers.getSetCookie();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toContain("oauth_state=;");
      expect(cookies[0]).toContain("Max-Age=0");
    });

    it("refuses a callback whose state does not match the cookie", async () => {
      const loginWithGoogle = vi.fn();
      const url = await start({ loginWithGoogle }, googleSignIn());

      const response = await fetch(url + "/auth/google/callback?state=abc&code=xyz", {
        redirect: "manual",
        headers: { Cookie: "oauth_state=other" },
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
      expect(loginWithGoogle).not.toHaveBeenCalled();
    });

    it("sets the oauth_state cookie on start, Secure only over https", async () => {
      const beginAuthorization = async () => ({ state: "abc", url: new URL("https://accounts.google.com/auth") });
      const sign = (redirectUri: string) =>
        ({ client: { beginAuthorization }, redirectUri, appUrl }) as unknown as GoogleSignIn;

      const plainUrl = await start({}, sign(googleRedirectUri));
      const plain = await fetch(plainUrl + "/auth/google/start", { redirect: "manual" });
      expect(plain.status).toBe(302);
      expect(plain.headers.get("set-cookie")).toContain("oauth_state=abc; HttpOnly");
      expect(plain.headers.get("set-cookie")).not.toContain("Secure");

      const secureUrl = await start({}, sign("https://api.example.vn/auth/google/callback"));
      const secure = await fetch(secureUrl + "/auth/google/start", { redirect: "manual" });
      expect(secure.headers.get("set-cookie")).toContain("; Secure");
    });
  });

  it("serves no refresh, logout or csrf routes", async () => {
    const url = await start({});
    expect((await fetch(url + "/auth/refresh", { method: "POST" })).status).toBe(401);
    expect((await fetch(url + "/auth/logout", { method: "POST" })).status).toBe(401);
    expect((await fetch(url + "/auth/csrf")).status).toBe(401);
  });

  describe("me", () => {
    it("reads the profile of the bearer token's account from the database", async () => {
      const findActiveAccount = vi.fn(async () => account({ displayName: "Tên mới" }));
      const url = await start({ findActiveAccount });

      const response = await fetch(url + "/auth/me", {
        headers: { authorization: await tokens.bearer({ actorId: accountId }) },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: accountId, displayName: "Tên mới" });
      expect(findActiveAccount).toHaveBeenCalledWith(accountId);
    });

    it("answers 401 without a bearer token", async () => {
      const url = await start({ findActiveAccount: async () => account() });

      const response = await fetch(url + "/auth/me");
      expect(response.status).toBe(401);
    });

    it("answers 401 for an account that has been deactivated since the token was issued", async () => {
      const url = await start({ findActiveAccount: async () => undefined });
      const response = await fetch(url + "/auth/me", { headers: { authorization: await tokens.bearer() } });
      expect(response.status).toBe(401);
    });

    it("answers 401 for an expired token", async () => {
      const url = await start({ findActiveAccount: async () => account() });
      const expired = await tokens.bearer({}, new Date(Date.now() - 86_400_000 - 60_000));
      const response = await fetch(url + "/auth/me", { headers: { authorization: expired } });
      expect(response.status).toBe(401);
    });

    it("serves a pcr token on the auth routes and refuses it on the admin routes", async () => {
      const url = await start({
        findActiveAccount: async () => account({ mustChangePassword: true, roles: ["Platform Admin"] }),
      });
      const authorization = await tokens.bearer({ roles: ["Platform Admin"], passwordChangeRequired: true });

      expect((await fetch(url + "/auth/me", { headers: { authorization } })).status).toBe(200);
      const admin = await fetch(url + "/admin/users", { headers: { authorization } });
      expect(admin.status).toBe(403);
      expect(await admin.json()).toMatchObject({ code: "password_change_required" });
    });
  });

  describe("jwks", () => {
    it("publishes the public key without authentication, and the key verifies the tokens", async () => {
      const url = await start({});

      const response = await fetch(url + "/.well-known/jwks.json");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { keys: Array<Record<string, unknown>> };
      expect(body.keys).toHaveLength(1);
      expect(body.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig", kid: "test-key" });
      expect(body.keys[0]).not.toHaveProperty("d");
    });
  });
});
