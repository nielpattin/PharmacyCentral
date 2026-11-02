import type { AccessTokenSigner } from "@pharmacy/auth";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  loginRequestSchema,
  phoneNumberSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
} from "../../../../contracts/identity.ts";

import type { Account } from "../../domain/account.ts";
import { AccountError, accountErrors } from "../../domain/account-error.ts";
import {
  AuthRateLimiterError,
  type AuthAdmission,
  type AuthRateLimitAction,
  type AuthRateLimiter,
} from "../../domain/auth-rate-limit.ts";
import type { AccountService } from "../../application/account-service.ts";
import type { GoogleSignIn } from "../../infrastructure/security/google-oidc-client.ts";
import type { AuditRecorder } from "../../../outbox/audit-recorder.ts";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  nextPassword: z.string().min(12).max(200),
});
const passwordResetRequestSchema = z.object({ email: z.string().email() });
const passwordResetSchema = z.object({
  accountId: z.string().uuid(),
  token: z.string().min(1),
  nextPassword: z.string().min(12).max(200),
});
const accountIdTokenSchema = z.object({ accountId: z.string().uuid(), token: z.string().min(1) });
const adminUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(200),
  displayName: z.string().trim().min(1).max(200),
  phoneNumber: phoneNumberSchema,
  roles: z.array(z.string()).max(8),
  siteIds: z.array(z.string().uuid()).max(500),
});
const userProfileSchema = z.object({ displayName: z.string().trim().min(1).max(200), phoneNumber: phoneNumberSchema });
const userAccessSchema = z.object({ roles: z.array(z.string()).max(8), siteIds: z.array(z.string().uuid()).max(500) });
const adminUserListSchema = z.object({ status: z.enum(["active", "deactivated"]).optional() });
const userIdSchema = z.object({ id: z.string().uuid() });
const employeesAtSiteSchema = z.object({ siteId: z.string().uuid() });
// A service caller resolves a page of orders at once; the cap keeps one request bounded.
const customerBatchSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });
// A one-character query would return the whole customer base, so the counter has to type at least three.
const customerLookupSchema = z.object({ q: z.string().trim().min(3).max(320) });
/** The counter roles that may search the customer accounts a prescription can be linked to. */
const customerLookupRoles = ["Pharmacist", "Platform Admin"];
/** The roles that assign plan owners: Platform Admin reads every active employee, Pharmacy Manager those at their sites. */
const staffDirectoryRoles = ["Pharmacy Manager", "Platform Admin"];
const platformAdminRole = "Platform Admin";

/**
 * Records a staff member acting on their own account: signing in. Shoppers are left out, because the audit log
 * is the staff trail and a shopper signing in is not a staff action.
 */
const auditOwnAccount = (
  audit: AuditRecorder,
  account: Pick<Account, "id" | "actorType">,
  action: string,
): Promise<void> =>
  account.actorType === "employee"
    ? audit.record({ action, entityType: "user", entityId: account.id, actorId: account.id })
    : Promise.resolve();

export const createAccountRouter = (
  service: AccountService,
  googleSignIn: GoogleSignIn | undefined,
  rateLimiter: AuthRateLimiter,
  audit: AuditRecorder,
  signer: AccessTokenSigner,
): Router => {
  const router = Router();

  router.get("/setup-status", async (_request, response) => {
    response.json(await service.getSetupStatus());
  });

  router.post("/setup-admin", async (request, response) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }

    try {
      const account = await service.createFirstAdmin(parsed.data);
      await audit.record({
        action: "identity.admin.setup",
        entityType: "user",
        entityId: account.id,
        actorId: account.id,
      });
      response.status(201).json(await signedInAccount(signer, account));
    } catch (error) {
      writeServiceError(response, error, 409);
    }
  });

  router.post("/register", async (request, response) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }
    if (!(await admitAuthAttempt(request, response, rateLimiter, "register", parsed.data.email))) return;

    try {
      const result = await service.registerCustomer(parsed.data);
      response.status(201).json({ account: toPublicAccount(result.account), emailVerificationRequired: true });
    } catch (error) {
      writeServiceError(response, error, 409);
    }
  });

  router.get("/verify-email", async (request, response) => {
    const parsed = accountIdTokenSchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid verification request", status: 400 });
      return;
    }
    if (!(await admitAuthAttempt(request, response, rateLimiter, "verify-email", parsed.data.accountId))) return;

    try {
      const account = await service.verifyEmail(parsed.data.accountId, parsed.data.token);
      response.json({ account: toPublicAccount(account), verified: true });
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  router.get("/google/start", async (_request, response) => {
    if (!googleSignIn) {
      response
        .status(503)
        .json({ title: "Google login is not configured", status: 503, code: "google_not_configured" });
      return;
    }

    try {
      const authorization = await googleSignIn.client.beginAuthorization();
      setOauthStateCookie(response, authorization.state, isHttps(googleSignIn.redirectUri));
      response.redirect(authorization.url.href);
    } catch (error) {
      writeServiceError(response, error, 503);
    }
  });

  router.get("/google/callback", async (request, response) => {
    if (!googleSignIn) {
      response
        .status(503)
        .json({ title: "Google login is not configured", status: 503, code: "google_not_configured" });
      return;
    }

    const state = typeof request.query.state === "string" ? request.query.state : undefined;
    const expectedState = getCookie(request, "oauth_state");
    if (!state || !expectedState || state !== expectedState) {
      response
        .status(400)
        .json({ title: "Invalid Google authorization state", status: 400, code: "invalid_oauth_state" });
      return;
    }

    try {
      const callbackUrl = new URL(request.originalUrl, googleSignIn.redirectUri);
      const profile = await googleSignIn.client.completeAuthorization(callbackUrl, state);
      const account = await service.loginWithGoogle(profile);
      const { token } = await signAccessToken(signer, account);
      clearOauthStateCookie(response);
      // The fragment never reaches a server or a log, so the token goes only to the page that reads it.
      response.redirect(`${googleSignIn.appUrl}/auth/callback#access_token=${token}`);
    } catch (error) {
      writeServiceError(response, error, 401);
    }
  });

  router.post("/login", async (request, response) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }
    const attempt = await admitAuthAttempt(request, response, rateLimiter, "login", parsed.data.email);
    if (!attempt) return;

    try {
      const account = await service.login(parsed.data);
      // Only failed sign-ins spend the budget: the attempt admitted above is withdrawn once the password checks out.
      // A counter that cannot withdraw leaves this success counted, and the sign-in itself must not fail over it.
      await attempt.withdraw().catch(() => undefined);
      await auditOwnAccount(audit, account, "identity.auth.login");
      response.json(await signedInAccount(signer, account));
    } catch (error) {
      // A failed staff sign-in is recorded without its password. The entry names the account when the email matched
      // one, and why it was refused. A shopper's failed sign-in is not recorded (no audit of shoppers' activity).
      if (parsed.data.audience === "employee" && error instanceof AccountError && error.reason !== undefined) {
        await audit.record({
          action: "identity.auth.login-failed",
          entityType: "user",
          entityId: error.accountId,
          details: { reason: error.reason },
        });
      }
      writeServiceError(response, error, 401);
    }
  });

  router.get("/me", async (request, response) => {
    const account = await currentAccount(service, request);
    if (!account) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }

    response.json(toPublicAccount(account));
  });

  router.patch("/me", async (request, response) => {
    const account = await currentAccount(service, request);
    if (!account) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }
    if (account.mustChangePassword) {
      writeServiceError(response, accountErrors.passwordChangeRequired(), 403);
      return;
    }

    const parsed = updateProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }

    try {
      const updated = await service.updateProfile(account.id, parsed.data);
      response.json(toPublicAccount(updated));
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  /**
   * The owner picker's directory. Platform Admin reads every active employee; a Pharmacy Manager reads the active
   * employees sharing one of the manager's sites. Only the name, roles and sites leave this route, never an email.
   */
  router.get("/staff-directory", async (request, response) => {
    const account = await currentAccount(service, request);
    if (!account) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }
    if (!account.roles.some((role) => staffDirectoryRoles.includes(role))) {
      response.status(403).json({
        title: "Pharmacy Manager role required",
        status: 403,
        code: "forbidden",
        detail: "Chỉ Quản lý nhà thuốc hoặc Quản trị nền tảng mới được xem danh sách nhân viên.",
      });
      return;
    }
    if (account.mustChangePassword) {
      writeServiceError(response, accountErrors.passwordChangeRequired(), 403);
      return;
    }

    const sharingSiteIds = account.roles.includes(platformAdminRole) ? undefined : account.siteIds;
    const employees = await service.listActiveEmployees(sharingSiteIds);
    response.json({
      employees: employees.map((employee) => ({
        id: employee.id,
        displayName: employee.displayName,
        roles: employee.roles,
        siteIds: employee.siteIds,
      })),
    });
  });

  router.post("/request-password-reset", async (request, response) => {
    const parsed = passwordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }
    if (!(await admitAuthAttempt(request, response, rateLimiter, "request-password-reset", parsed.data.email))) return;

    await service.requestPasswordReset(parsed.data.email);
    response.status(202).json({ accepted: true });
  });

  router.post("/reset-password", async (request, response) => {
    const parsed = passwordResetSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }
    if (!(await admitAuthAttempt(request, response, rateLimiter, "reset-password", parsed.data.accountId))) return;

    try {
      await service.resetPassword(parsed.data.accountId, parsed.data.token, parsed.data.nextPassword);
      response.status(204).end();
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  router.post("/change-password", async (request, response) => {
    const account = await currentAccount(service, request);
    if (!account) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }

    try {
      const changed = await service.changePassword(account.id, parsed.data.currentPassword, parsed.data.nextPassword);
      response.json(await signedInAccount(signer, changed));
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  return router;
};

/**
 * The administrator's routes. Every change is audited inside the service, in the same transaction as the change, so
 * the router writes no audit entry of its own.
 */
export const createAdminRouter = (service: AccountService): Router => {
  const router = Router();

  router.use(async (request, response, next) => {
    const account = await currentAccount(service, request);
    if (!account) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }
    if (!account.roles.includes("Platform Admin")) {
      response.status(403).json({
        title: "Platform Admin role required",
        status: 403,
        code: "forbidden",
        detail: "Chỉ Quản trị nền tảng mới được thực hiện thao tác này.",
      });
      return;
    }
    if (account.mustChangePassword) {
      writeServiceError(response, accountErrors.passwordChangeRequired(), 403);
      return;
    }

    response.locals.adminId = account.id;
    next();
  });

  router.get("/roles", async (_request, response) => response.json({ roles: await service.listRoles() }));

  router.get("/users", async (request, response) => {
    const parsed = adminUserListSchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        detail: "Dữ liệu gửi lên không hợp lệ.",
      });
      return;
    }

    response.json((await service.listUsers(parsed.data.status)).map(toPublicAccount));
  });

  router.post("/users", async (request, response) => {
    const parsed = adminUserSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        detail: "Dữ liệu gửi lên không hợp lệ.",
      });
      return;
    }

    try {
      const created = await service.createEmployee(response.locals.adminId as string, parsed.data);
      response.status(201).json(toPublicAccount(created));
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  router.put("/users/:id/access", async (request, response) => {
    const id = userIdSchema.safeParse(request.params);
    const parsed = userAccessSchema.safeParse(request.body);
    if (!id.success || !parsed.success) {
      response.status(400).json({
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        detail: "Dữ liệu gửi lên không hợp lệ.",
      });
      return;
    }

    try {
      const updated = await service.updateUserAccess(
        response.locals.adminId as string,
        id.data.id,
        parsed.data.roles,
        parsed.data.siteIds,
      );
      response.json(toPublicAccount(updated));
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  router.put("/users/:id/profile", async (request, response) => {
    const id = userIdSchema.safeParse(request.params);
    const parsed = userProfileSchema.safeParse(request.body);
    if (!id.success || !parsed.success) {
      response.status(400).json({
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        detail: "Dữ liệu gửi lên không hợp lệ.",
      });
      return;
    }

    try {
      const updated = await service.updateEmployeeProfile(response.locals.adminId as string, id.data.id, parsed.data);
      response.json(toPublicAccount(updated));
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  router.post("/users/:id/reset-password", async (request, response) => {
    const id = userIdSchema.safeParse(request.params);
    const password = z.object({ password: z.string().min(12).max(200) }).safeParse(request.body);
    if (!id.success || !password.success) {
      response.status(400).json({
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        detail: "Dữ liệu gửi lên không hợp lệ.",
      });
      return;
    }

    try {
      await service.resetUserPassword(response.locals.adminId as string, id.data.id, password.data.password);
      response.status(204).end();
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  router.post("/users/:id/deactivate", async (request, response) => {
    const id = userIdSchema.safeParse(request.params);
    if (!id.success) {
      response.status(400).json({
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        detail: "Dữ liệu gửi lên không hợp lệ.",
      });
      return;
    }

    try {
      await service.deactivateEmployee(response.locals.adminId as string, id.data.id);
      response.status(204).end();
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  router.post("/users/:id/activate", async (request, response) => {
    const id = userIdSchema.safeParse(request.params);
    if (!id.success) {
      response.status(400).json({
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        detail: "Dữ liệu gửi lên không hợp lệ.",
      });
      return;
    }

    try {
      await service.activateEmployee(response.locals.adminId as string, id.data.id);
      response.status(204).end();
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  return router;
};

/**
 * The counter's customer picker. A shopper cannot reach the customer base through it: only a counter role passes, and
 * only customer accounts are ever returned.
 */
export const createCustomerRouter = (service: AccountService): Router => {
  const router = Router();

  router.use(async (request, response, next) => {
    const account = await currentAccount(service, request);
    if (!account) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }
    if (!account.roles.some((role) => customerLookupRoles.includes(role))) {
      response.status(403).json({
        title: "Pharmacist role required",
        status: 403,
        code: "forbidden",
        detail: "Chỉ Dược sĩ hoặc Quản trị nền tảng mới được tra cứu khách hàng.",
      });
      return;
    }
    if (account.mustChangePassword) {
      writeServiceError(response, accountErrors.passwordChangeRequired(), 403);
      return;
    }

    next();
  });

  router.get("/lookup", async (request, response) => {
    const parsed = customerLookupSchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        title: "Invalid customer lookup",
        status: 400,
        code: "invalid_request",
        detail: "Nhập ít nhất 3 ký tự để tra cứu.",
      });
      return;
    }

    response.json(await service.searchCustomers(parsed.data.q));
  });

  return router;
};

/**
 * Service-to-service resolution of customers and employees, mounted outside `publicPaths` so the trusted middleware
 * has already proven the internal service secret. The handler then insists on the system actor the middleware stamps
 * for a service call, so an employee's signed context cannot borrow this answer. No gateway routes this path. identity
 * does not check roles or sites: the calling service does, before it asks.
 */
export const createInternalRouter = (service: AccountService): Router => {
  const router = Router();

  router.use((request, response, next) => {
    if (request.header("x-actor-type") !== "system") {
      response.status(403).json({
        title: "System actor required",
        status: 403,
        code: "forbidden",
        detail: "Chỉ hệ thống nội bộ được gọi đường dẫn này.",
      });
      return;
    }

    next();
  });

  // Staff contact rule (staff-online-orders, decision 14): a customer's name and phone show on an order only to
  // Pharmacist, Pharmacy Manager and Platform Admin, and only for orders at their assigned sites. The calling service
  // enforces that; this route answers the service and nobody else. BR-USER-011 is the separate counter lookup rule.
  router.post("/customers/batch", async (request, response) => {
    const parsed = customerBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        title: "Invalid customer batch",
        status: 400,
        code: "invalid_request",
        detail: "Danh sách mã khách không hợp lệ.",
      });
      return;
    }

    response.json({ customers: await service.findActiveCustomers(parsed.data.ids) });
  });

  router.get("/customers/:id", async (request, response) => {
    const parsed = userIdSchema.safeParse(request.params);
    if (!parsed.success) {
      response.status(400).json({
        title: "Invalid customer id",
        status: 400,
        code: "invalid_request",
        detail: "Mã khách hàng không hợp lệ.",
      });
      return;
    }
    const customer = await service.findActiveCustomer(parsed.data.id);
    if (!customer) {
      response.status(404).json({
        title: "Customer account not found",
        status: 404,
        detail: "Không tìm thấy tài khoản khách hàng.",
      });
      return;
    }

    response.json(customer);
  });

  // The automatic owner of an action plan is chosen from the active employees at the plan's site. The calling service
  // filters by role; this answers names, roles and sites, never an email.
  router.get("/employees", async (request, response) => {
    const parsed = employeesAtSiteSchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        title: "Invalid site id",
        status: 400,
        code: "invalid_request",
        detail: "Mã cơ sở không hợp lệ.",
      });
      return;
    }
    const employees = await service.listActiveEmployees([parsed.data.siteId]);
    response.json({
      employees: employees.map((employee) => ({
        id: employee.id,
        displayName: employee.displayName,
        roles: employee.roles,
        siteIds: employee.siteIds,
      })),
    });
  });

  // The owner check of an action plan reads an employee's name, roles and sites. A customer or a deactivated account
  // answers 404, so a caller cannot use this route to tell a shopper's id from an unknown one.
  router.get("/employees/:id", async (request, response) => {
    const parsed = userIdSchema.safeParse(request.params);
    if (!parsed.success) {
      response.status(400).json({
        title: "Invalid employee id",
        status: 400,
        code: "invalid_request",
        detail: "Mã nhân viên không hợp lệ.",
      });
      return;
    }
    const employee = await service.findActiveEmployee(parsed.data.id);
    if (!employee) {
      response.status(404).json({
        title: "Employee account not found",
        status: 404,
        detail: "Không tìm thấy tài khoản nhân viên.",
      });
      return;
    }

    response.json({
      id: employee.id,
      displayName: employee.displayName,
      roles: employee.roles,
      siteIds: employee.siteIds,
      isActive: true,
    });
  });

  return router;
};

const toPublicAccount = (account: Account) => ({
  id: account.id,
  actorType: account.actorType,
  email: account.email,
  displayName: account.displayName,
  phoneNumber: account.phoneNumber ?? null,
  emailVerified: account.emailVerifiedAt !== undefined,
  isActive: account.isActive,
  passwordChangeRequired: account.mustChangePassword,
  roles: account.roles,
  siteIds: account.siteIds,
});

const signAccessToken = (signer: AccessTokenSigner, account: Account) =>
  signer.sign({
    actorId: account.id,
    actorType: account.actorType,
    roles: account.roles,
    siteIds: account.siteIds,
    passwordChangeRequired: account.mustChangePassword,
  });

/** The profile with a fresh access token, valid until its expiry. */
const signedInAccount = async (signer: AccessTokenSigner, account: Account) => {
  const { token, expiresAt } = await signAccessToken(signer, account);
  return { ...toPublicAccount(account), accessToken: token, accessTokenExpiresAt: expiresAt.toISOString() };
};

/**
 * The active account the trusted-request middleware verified from the bearer token, read from the database so a
 * profile or access change shows at once. That middleware overwrites or deletes the actor headers of every request.
 */
const currentAccount = async (service: AccountService, request: Request): Promise<Account | undefined> => {
  const accountId = request.header("x-actor-id");
  return accountId ? service.findActiveAccount(accountId) : undefined;
};

/**
 * Admits one attempt before any credential is checked, so a refused attempt answers the same whether or not the
 * account exists. Returns the admitted attempt, or `undefined` once the response has been written.
 */
const admitAuthAttempt = async (
  request: Request,
  response: Response,
  rateLimiter: AuthRateLimiter,
  action: AuthRateLimitAction,
  subject: string,
): Promise<Extract<AuthAdmission, { admitted: true }> | undefined> => {
  let admission: AuthAdmission;
  try {
    admission = await rateLimiter.admit(action, subject, request.ip ?? "unknown");
  } catch (error) {
    if (!(error instanceof AuthRateLimiterError)) throw error;
    // A counter that cannot count cannot let the credential check run unmetered.
    response.status(503).json({ title: "Rate limiter unavailable", status: 503, code: "rate_limit_unavailable" });
    return undefined;
  }
  if (admission.admitted) return admission;

  response.setHeader("Retry-After", String(admission.retryAfterSeconds));
  response.status(429).json({ title: "Too many requests", status: 429, code: "rate_limited" });
  return undefined;
};

const getCookie = (request: Request, name: string): string | undefined => {
  const cookieHeader = request.headers.cookie;
  const match = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
};

const isHttps = (url: string): boolean => new URL(url).protocol === "https:";

/** The Google authorization state, kept for the ten minutes the round trip to Google may take. */
const setOauthStateCookie = (response: Response, state: string, secure: boolean): void => {
  response.append(
    "Set-Cookie",
    `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure ? "; Secure" : ""}`,
  );
};

const clearOauthStateCookie = (response: Response): void => {
  response.append("Set-Cookie", "oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
};

/** A refusal the domain made answers its own status, code and Vietnamese detail; anything else answers a generic problem. */
const writeServiceError = (response: Response, error: unknown, defaultStatus: number): void => {
  if (error instanceof AccountError) {
    response
      .status(error.status)
      .json({ title: error.message, status: error.status, code: error.code, detail: error.detail });
    return;
  }
  const message = error instanceof Error ? error.message : "Request failed";
  const status = message.includes("already exists") ? 409 : defaultStatus;
  response.status(status).json({ title: message, status, code: status === 409 ? "conflict" : "request_failed" });
};
