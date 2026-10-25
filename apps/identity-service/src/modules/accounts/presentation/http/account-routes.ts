import { randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  loginRequestSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
} from "../../../../contracts/identity.ts";

import type { Account } from "../../domain/account.ts";
import {
  AuthRateLimiterError,
  type AuthAdmission,
  type AuthRateLimitAction,
  type AuthRateLimiter,
} from "../../domain/auth-rate-limit.ts";
import type { AccountService } from "../../application/account-service.ts";
import { signInternalIdentityContext } from "../../../../middleware/trusted-request.ts";
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
  roles: z.array(z.string()).max(8),
  siteIds: z.array(z.string().uuid()).max(500),
});
const userAccessSchema = z.object({ roles: z.array(z.string()).max(8), siteIds: z.array(z.string().uuid()).max(500) });
const userIdSchema = z.object({ id: z.string().uuid() });
// A one-character query would return the whole customer base, so the counter has to type at least three.
const customerLookupSchema = z.object({ q: z.string().trim().min(3).max(320) });
const sessionCookieName = "pharmacy_session";
const csrfCookieName = "pharmacy_csrf";
/** The counter roles that may search the customer accounts a prescription can be linked to. */
const customerLookupRoles = ["Pharmacist", "Platform Admin"];

/**
 * Records a staff member acting on their own account: signing in or out, changing a password or a profile. Shoppers
 * are left out, because the audit log is the staff trail and a shopper signing in is not a staff action.
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
      const result = await service.createFirstAdmin(parsed.data);
      await audit.record({
        action: "identity.admin.setup",
        entityType: "user",
        entityId: result.account.id,
        actorId: result.account.id,
      });
      setSessionCookie(response, result.session.rawToken);
      response.status(201).json(toPublicAccount(result.account));
    } catch (error) {
      writeServiceError(response, error, 409);
    }
  });

  const contextAudiences = [
    "catalog-service",
    "inventory-service",
    "sales-service",
    "payment-service",
    "operations-query-service",
    "chatbot-service",
    "ops-console-service",
  ];

  router.get("/context", async (request, response) => {
    const token = getSessionToken(request);
    const current = token ? await service.currentSession(token) : undefined;
    if (!current) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }
    const secret = process.env.INTERNAL_IDENTITY_SECRET;
    if (!secret) {
      response
        .status(503)
        .json({ title: "Identity signing is not configured", status: 503, code: "identity_unconfigured" });
      return;
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    const contexts: Record<string, string> = {};
    for (const audience of contextAudiences) {
      contexts[audience] = signInternalIdentityContext(
        {
          version: "v1",
          requestId: randomUUID(),
          correlationId: randomUUID(),
          actorId: current.account.id,
          actorType: current.account.actorType,
          roles: current.account.roles,
          siteIds: current.account.siteIds,
          issuedAt: now.toISOString(),
          expiresAt,
          audience,
        },
        secret,
      );
    }
    response.json({ contexts, expiresAt });
  });

  router.get("/csrf", async (_request, response) => {
    const token = randomBytes(32).toString("hex");
    setReadableCookie(response, csrfCookieName, token, 3600);
    response.json({ csrfToken: token });
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
      setCookie(response, "oauth_state", authorization.state, 600);
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
      const result = await service.loginWithGoogle(profile);
      setSessionCookie(response, result.session.rawToken);
      clearCookie(response, "oauth_state");
      response.json(toPublicAccount(result.account));
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
      const result = await service.login(parsed.data);
      // Only failed sign-ins spend the budget: the attempt admitted above is withdrawn once the password checks out.
      // A counter that cannot withdraw leaves this success counted, and the sign-in itself must not fail over it.
      await attempt.withdraw().catch(() => undefined);
      setSessionCookie(response, result.session.rawToken);
      await auditOwnAccount(audit, result.account, "identity.auth.login");
      response.json(toPublicAccount(result.account));
    } catch (error) {
      writeServiceError(response, error, 401);
    }
  });

  router.post("/logout", async (request, response) => {
    const token = getSessionToken(request);
    if (token) {
      const current = await service.currentSession(token);
      await service.logout(token);
      if (current) await auditOwnAccount(audit, current.account, "identity.auth.logout");
    }
    clearSessionCookie(response);
    response.status(204).end();
  });

  router.get("/me", async (request, response) => {
    const token = getSessionToken(request);
    const current = token ? await service.currentSession(token) : undefined;
    if (!current) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }

    response.json(toPublicAccount(current.account));
  });

  router.patch("/me", async (request, response) => {
    const token = getSessionToken(request);
    const current = token ? await service.currentSession(token) : undefined;
    if (!current) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }

    const parsed = updateProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }

    try {
      const updated = await service.updateProfile(current.account.id, parsed.data);
      await auditOwnAccount(audit, updated, "identity.account.profile-updated");
      response.json(toPublicAccount(updated));
    } catch (error) {
      writeServiceError(response, error, 400);
    }
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
    const token = getSessionToken(request);
    const current = token ? await service.currentSession(token) : undefined;
    if (!current) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }

    try {
      await service.changePassword(current.account.id, parsed.data.currentPassword, parsed.data.nextPassword);
      await auditOwnAccount(audit, current.account, "identity.account.password-changed");
      clearSessionCookie(response);
      response.status(204).end();
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  return router;
};

export const createAdminRouter = (service: AccountService, audit: AuditRecorder): Router => {
  const router = Router();
  /** Records one administrator action on another account. The roles and sites are kept; passwords never are. */
  const auditAdmin = (
    response: Response,
    action: string,
    userId: string,
    details?: Record<string, string | number | boolean | null>,
  ): Promise<void> =>
    audit.record({
      action,
      entityType: "user",
      entityId: userId,
      actorId: response.locals.adminId as string,
      ...(details ? { details } : {}),
    });

  router.use(async (request, response, next) => {
    const token = getSessionToken(request);
    const current = token ? await service.currentSession(token) : undefined;
    if (!current) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }
    if (!current.account.roles.includes("Platform Admin")) {
      response.status(403).json({ title: "Platform Admin role required", status: 403, code: "forbidden" });
      return;
    }

    response.locals.adminId = current.account.id;
    next();
  });

  router.get("/roles", async (_request, response) => response.json({ roles: await service.listRoles() }));
  router.get("/users", async (_request, response) => response.json((await service.listUsers()).map(toPublicAccount)));

  router.post("/users", async (request, response) => {
    const parsed = adminUserSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }

    try {
      const created = await service.createEmployee(parsed.data);
      await auditAdmin(response, "identity.user.created", created.id, {
        roles: created.roles.join(","),
        sites: created.siteIds.length,
      });
      response.status(201).json(toPublicAccount(created));
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  router.put("/users/:id/access", async (request, response) => {
    const id = userIdSchema.safeParse(request.params);
    const parsed = userAccessSchema.safeParse(request.body);
    if (!id.success || !parsed.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }

    try {
      const updated = await service.updateUserAccess(id.data.id, parsed.data.roles, parsed.data.siteIds);
      await auditAdmin(response, "identity.user.access-updated", updated.id, {
        roles: updated.roles.join(","),
        sites: updated.siteIds.length,
      });
      response.json(toPublicAccount(updated));
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  router.post("/users/:id/reset-password", async (request, response) => {
    const id = userIdSchema.safeParse(request.params);
    const password = z.object({ password: z.string().min(12).max(200) }).safeParse(request.body);
    if (!id.success || !password.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }

    try {
      await service.resetUserPassword(id.data.id, password.data.password);
      await auditAdmin(response, "identity.user.password-reset", id.data.id);
      response.status(204).end();
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  router.post("/users/:id/revoke-sessions", async (request, response) => {
    const id = userIdSchema.safeParse(request.params);
    if (!id.success) {
      response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
      return;
    }

    try {
      await service.revokeAllSessions(id.data.id);
      await auditAdmin(response, "identity.user.sessions-revoked", id.data.id);
      response.status(204).end();
    } catch (error) {
      writeServiceError(response, error, 400);
    }
  });

  return router;
};

/**
 * The counter's customer picker. It reads the same session cookie the `/auth` router does, because the trusted
 * middleware exempts `/customers` from gateway checks the way it exempts `/admin`. A shopper cannot reach the
 * customer base through it: only a counter role passes, and only customer accounts are ever returned.
 */
export const createCustomerRouter = (service: AccountService): Router => {
  const router = Router();

  router.use(async (request, response, next) => {
    const token = getSessionToken(request);
    const current = token ? await service.currentSession(token) : undefined;
    if (!current) {
      response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
      return;
    }
    if (!current.account.roles.some((role) => customerLookupRoles.includes(role))) {
      response.status(403).json({ title: "Pharmacist role required", status: 403, code: "forbidden" });
      return;
    }

    next();
  });

  router.get("/lookup", async (request, response) => {
    const parsed = customerLookupSchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid customer lookup", status: 400, code: "invalid_request" });
      return;
    }

    response.json(await service.searchCustomers(parsed.data.q));
  });

  return router;
};

/**
 * Service-to-service customer resolution, mounted outside `publicPaths` so the trusted middleware has already
 * proven the internal service secret. The handler then insists on the system actor the middleware stamps for a
 * service call, so an employee's signed context cannot borrow this answer. No gateway routes this path.
 */
export const createInternalCustomerRouter = (service: AccountService): Router => {
  const router = Router();

  router.use((request, response, next) => {
    if (request.header("x-actor-type") !== "system") {
      response.status(403).json({ title: "System actor required", status: 403, code: "forbidden" });
      return;
    }

    next();
  });

  router.get("/customers/:id", async (request, response) => {
    const parsed = userIdSchema.safeParse(request.params);
    if (!parsed.success) {
      response.status(400).json({ title: "Invalid customer id", status: 400, code: "invalid_request" });
      return;
    }
    const customer = await service.findActiveCustomer(parsed.data.id);
    if (!customer) {
      response.status(404).json({ title: "Customer account not found", status: 404 });
      return;
    }

    response.json(customer);
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
  roles: account.roles,
  siteIds: account.siteIds,
});

const getSessionToken = (request: Request): string | undefined => getCookie(request, sessionCookieName);

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

const setReadableCookie = (response: Response, name: string, value: string, maxAge: number): void => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${name}=${value}; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
};

const setSessionCookie = (response: Response, token: string): void => {
  setCookie(response, sessionCookieName, token, 604800);
};

const setCookie = (response: Response, name: string, value: string, maxAge: number): void => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
};

const clearSessionCookie = (response: Response): void => clearCookie(response, sessionCookieName);

const clearCookie = (response: Response, name: string): void => {
  response.setHeader("Set-Cookie", `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
};

const writeServiceError = (response: Response, error: unknown, defaultStatus: number): void => {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = message.includes("already exists") ? 409 : defaultStatus;
  response.status(status).json({ title: message, status, code: status === 409 ? "conflict" : "request_failed" });
};
