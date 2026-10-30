import { createHmac, timingSafeEqual } from "node:crypto";
import { trace } from "@opentelemetry/api";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { createLogger } from "../logger.ts";
import {
  internalIdentityContextSchema,
  signedInternalIdentityContextSchema,
  type InternalIdentityContext,
  type SignedInternalIdentityContext,
} from "../contracts/common.ts";

const logger = createLogger({ name: "inventory-service" });

export interface TrustedRequestEnforcementOptions {
  /**
   * Secret used to verify HMAC signed internal identity context.
   * Defaults to process.env.INTERNAL_IDENTITY_SECRET.
   */
  identitySecret?: string | undefined;

  /**
   * Secret used for direct inter-service authentication.
   * Defaults to process.env.INTERNAL_SERVICE_SECRET.
   */
  serviceSecret?: string | undefined;

  /**
   * Expected audience for the signed internal identity context.
   * Defaults to process.env.INTERNAL_IDENTITY_AUDIENCE.
   */
  expectedAudience?: string | string[] | undefined;

  /**
   * Health check path prefixes exempt from trusted gateway checks.
   * Defaults to DEFAULT_HEALTH_PREFIXES.
   */
  healthPaths?: string[] | undefined;

  /**
   * Public path prefixes exempt from trusted gateway checks (e.g. public auth routes).
   */
  publicPaths?: string[] | undefined;

  /**
   * Additional site-scoped route prefixes that require assigned sites for employees.
   */
  siteScopedPaths?: string[] | undefined;

  /**
   * Custom predicate to determine if a request is public/exempt.
   */
  isPublic?: ((request: Request) => boolean) | undefined;
}

export const DEFAULT_HEALTH_PREFIXES: readonly string[] = ["/health", "/api/health"];

export const DEFAULT_SITE_SCOPED_PREFIXES: readonly string[] = [
  "/procurement/purchase-orders",
  "/procurement/goods-receipts",
  "/procurement/replenishment-suggestions",
  "/inventory/balances",
  "/inventory/batches",
  "/inventory/movements",
  "/inventory/transfers",
  "/inventory/stocktakes",
  "/inventory/returns",
  "/inventory/replenishment",
  "/inventory/action-plans",
  "/inventory/adjustments",
  "/dashboard/summary",
  "/operations/dashboard",
  "/finance/summary",
  "/operations/finance",
  "/reports",
  "/audit/logs",
  "/operations/audit",
];

/**
 * The counter's own prefixes. `deploy/aws/lambda/policy.mjs` refuses a shopper on the same paths at the edge, but the
 * local topology has no authorizer and hands every shopper a signed context, so the split has to hold here too.
 */
export const DEFAULT_EMPLOYEE_PREFIXES: readonly string[] = [
  "/procurement",
  "/inventory",
  "/operations",
  "/dashboard",
  "/finance",
  "/audit",
  "/reports",
  "/prescriptions",
  "/counter-transactions",
  "/admin",
  "/customers",
];

/** Reading catalog master data is public; writing it is a staff action. */
export const DEFAULT_EMPLOYEE_WRITE_PREFIXES: readonly string[] = [
  "/sites",
  "/storage-locations",
  "/suppliers",
  "/products",
  "/pricing/prices",
];

export type CustomerRequestException = {
  method: string;
  path: string;
  /** `exact` is the whole path, `segment` is the path and everything below it, `child` is one segment below it. */
  match: "exact" | "segment" | "child";
};

/**
 * Requests a shopper may keep making on a path the employee prefixes would otherwise refuse. The prescription entries
 * mirror `customerPrescriptionRequests` and the invoice entries mirror payment's customer carve-outs in
 * `deploy/aws/lambda/policy.mjs`; the invoice read is a shopper's own receipt, served with an owner check by
 * payment-service, so this service-side list keeps it reachable where the edge policy is stricter.
 */
export const DEFAULT_CUSTOMER_REQUEST_EXCEPTIONS: readonly CustomerRequestException[] = [
  { method: "GET", path: "/prescriptions", match: "exact" },
  { method: "GET", path: "/prescriptions/consultations", match: "exact" },
  { method: "POST", path: "/prescriptions/consultations", match: "exact" },
  { method: "POST", path: "/prescriptions/intake/qr", match: "segment" },
  { method: "POST", path: "/prescriptions/intake/image", match: "segment" },
  { method: "POST", path: "/payments/invoices", match: "exact" },
  { method: "GET", path: "/payments/invoices", match: "child" },
];

export const IDENTITY_PUBLIC_AUTH_PATHS: readonly string[] = [
  "/auth/login",
  "/auth/register",
  "/auth/setup-admin",
  "/auth/setup-status",
  "/auth/verify-email",
  "/auth/google/start",
  "/auth/google/callback",
];

export const normalizePath = (path: string): string => {
  const clean = path.split("?")[0]?.trim() ?? "/";
  return clean.startsWith("/") ? clean : `/${clean}`;
};

export const matchesPathPrefix = (path: string, prefix: string): boolean => {
  const normPath = normalizePath(path);
  const normPrefix = normalizePath(prefix);
  if (normPath === normPrefix || normPath.startsWith(`${normPrefix}/`)) return true;

  const withoutApi = normPath.startsWith("/api/") ? normPath.slice(4) : normPath === "/api" ? "/" : normPath;
  const prefixWithoutApi = normPrefix.startsWith("/api/")
    ? normPrefix.slice(4)
    : normPrefix === "/api"
      ? "/"
      : normPrefix;
  return withoutApi === prefixWithoutApi || withoutApi.startsWith(`${prefixWithoutApi}/`);
};

/** The path as the service sees it: the gateway strips `/api`, whereas a direct call or a test may not. */
const stripApiPrefix = (path: string): string => {
  const normalized = normalizePath(path);
  if (normalized === "/api") return "/";
  return normalized.startsWith("/api/") ? normalized.slice(4) : normalized;
};

const matchesSingleChildPath = (path: string, prefix: string): boolean => {
  const normalized = stripApiPrefix(path);
  const base = stripApiPrefix(prefix);
  if (!normalized.startsWith(`${base}/`)) return false;
  const remainder = normalized.slice(base.length + 1);
  return remainder.length > 0 && !remainder.includes("/");
};

const matchesCustomerException = (exception: CustomerRequestException, path: string, method: string): boolean => {
  if (method.toUpperCase() !== exception.method.toUpperCase()) return false;
  if (exception.match === "exact") return stripApiPrefix(path) === stripApiPrefix(exception.path);
  if (exception.match === "child") return matchesSingleChildPath(path, exception.path);
  return matchesPathPrefix(path, exception.path);
};

/**
 * True when the path belongs behind the counter rather than to the shopper, the same split
 * `deploy/aws/lambda/policy.mjs` makes with `employeePrefixes`, `catalogWritePrefixes` and its payment carve-outs.
 * The exemptions are checked first, so a shared path such as the prescription list stays the shopper's.
 */
export const isEmployeePath = (path: string, method: string): boolean => {
  if (DEFAULT_CUSTOMER_REQUEST_EXCEPTIONS.some((exception) => matchesCustomerException(exception, path, method))) {
    return false;
  }
  const upperMethod = method.toUpperCase();
  const isRead = upperMethod === "GET" || upperMethod === "HEAD" || upperMethod === "OPTIONS";
  if (DEFAULT_EMPLOYEE_PREFIXES.some((prefix) => matchesPathPrefix(path, prefix))) return true;
  if (!isRead && DEFAULT_EMPLOYEE_WRITE_PREFIXES.some((prefix) => matchesPathPrefix(path, prefix))) return true;
  return matchesPathPrefix(path, "/payments") && !matchesPathPrefix(path, "/payments/sepay/webhook");
};

/** The roles of the verified employee the request acts for (read by `modules/access-control.ts`). */
export const actorRoles = (request: Request): string[] => {
  const roles = request.header(ACTOR_ROLES_HEADER);
  return roles === undefined ? [] : roles.split(",").filter((role) => role.length > 0);
};

export const ACTOR_ROLES_HEADER = "x-actor-roles";

// Restates `employeeRoleRules` of deploy/aws/lambda/policy.mjs for this service. Methods: "*", "READ", "WRITE" or a name.
type Route = { methods: readonly string[]; path: string; exact?: boolean };
type RoleRule = Route & { roles: readonly string[] };

const ROLE_RULES: readonly RoleRule[] = [
  { methods: ["*"], path: "/procurement/purchase-orders", roles: ["Pharmacy Manager", "Warehouse Staff"] },
  { methods: ["WRITE"], path: "/procurement/purchase-orders", roles: ["Pharmacy Manager"] },
  // Replenishment suggestions and their draft orders (design 0007): a Pharmacy Manager; Platform Admin reads.
  { methods: ["*"], path: "/procurement/replenishment-suggestions", roles: ["Pharmacy Manager"] },
  { methods: ["*"], path: "/procurement/goods-receipts", roles: ["Warehouse Staff"] },
  { methods: ["*"], path: "/inventory/imports/opening-balances", exact: true, roles: ["Warehouse Staff"] },
  { methods: ["READ"], path: "/inventory/replenishment", roles: ["Pharmacist", "Pharmacy Manager", "Warehouse Staff"] },
  { methods: ["POST"], path: "/inventory/replenishment", exact: true, roles: ["Pharmacist", "Pharmacy Manager"] },
  {
    methods: ["POST"],
    path: "/inventory/replenishment/*/cancel",
    exact: true,
    roles: ["Pharmacist", "Pharmacy Manager", "Warehouse Staff"],
  },
  { methods: ["WRITE"], path: "/inventory/replenishment", roles: ["Warehouse Staff"] },
  // Action plans (design 0007): the owner, a manager, or Warehouse Staff reads or moves a plan; Platform Admin and a
  // manager may reassign it. Which plans a caller sees, and which fields a caller may change, is checked by the route.
  { methods: ["READ"], path: "/inventory/action-plans", roles: ["Pharmacist", "Pharmacy Manager", "Warehouse Staff"] },
  { methods: ["POST"], path: "/inventory/action-plans", exact: true, roles: ["Pharmacy Manager"] },
  {
    methods: ["PATCH"],
    path: "/inventory/action-plans/*",
    exact: true,
    roles: ["Platform Admin", "Pharmacist", "Pharmacy Manager", "Warehouse Staff"],
  },
  { methods: ["READ"], path: "/inventory/batches", roles: ["Pharmacist", "Pharmacy Manager", "Warehouse Staff"] },
  { methods: ["POST"], path: "/inventory/batches/*/quality", exact: true, roles: ["Pharmacist", "Pharmacy Manager"] },
  { methods: ["WRITE"], path: "/inventory/batches", roles: ["Warehouse Staff"] },
  { methods: ["READ"], path: "/inventory/movements", roles: ["Pharmacy Manager", "Warehouse Staff"] },
  { methods: ["WRITE"], path: "/inventory/movements", roles: ["Warehouse Staff"] },
  { methods: ["READ"], path: "/inventory/adjustments", roles: ["Pharmacy Manager", "Warehouse Staff"] },
  { methods: ["POST"], path: "/inventory/adjustments/*/*", exact: true, roles: ["Pharmacy Manager"] },
  { methods: ["WRITE"], path: "/inventory/adjustments", roles: ["Warehouse Staff"] },
  { methods: ["READ"], path: "/inventory/transfers", roles: ["Pharmacy Manager", "Warehouse Staff"] },
  { methods: ["POST"], path: "/inventory/transfers/*/approve", exact: true, roles: ["Pharmacy Manager"] },
  {
    methods: ["POST"],
    path: "/inventory/transfers/*/cancel",
    exact: true,
    roles: ["Pharmacy Manager", "Warehouse Staff"],
  },
  { methods: ["WRITE"], path: "/inventory/transfers", roles: ["Warehouse Staff"] },
  { methods: ["READ"], path: "/inventory/stocktakes", roles: ["Pharmacy Manager", "Warehouse Staff"] },
  { methods: ["POST"], path: "/inventory/stocktakes/*/post", exact: true, roles: ["Pharmacy Manager"] },
  { methods: ["WRITE"], path: "/inventory/stocktakes", roles: ["Warehouse Staff"] },
  { methods: ["WRITE"], path: "/inventory/stocktake-lines", roles: ["Warehouse Staff"] },
  { methods: ["READ"], path: "/inventory/returns", roles: ["Pharmacy Manager", "Warehouse Staff"] },
  { methods: ["POST"], path: "/inventory/returns/*/*", exact: true, roles: ["Pharmacy Manager"] },
  { methods: ["WRITE"], path: "/inventory/returns", roles: ["Warehouse Staff"] },
];

const ROLE_FORBIDDEN_DETAIL = "Vai trò của tài khoản này không được thực hiện thao tác này.";

const routeMatches = (route: Route, path: string, method: string): boolean => {
  const upper = method.toUpperCase();
  const isRead = upper === "GET" || upper === "HEAD";
  if (!route.methods.some((m) => m === "*" || m === upper || (m === "READ" && isRead) || (m === "WRITE" && !isRead))) {
    return false;
  }
  const actual = stripApiPrefix(path).split("/");
  const expected = route.path.split("/");
  if (route.exact ? actual.length !== expected.length : actual.length < expected.length) return false;
  return expected.every((segment, index) =>
    segment === "*" ? (actual[index] ?? "") !== "" : actual[index] === segment,
  );
};

/**
 * A role the rule names passes. A route with no rule, or a rule that names no role, admits any employee. Platform Admin
 * is read-only: it reads every route, and writes only where a rule names it.
 */
const roleRefusal = (path: string, method: string, roles: readonly string[]): string | undefined => {
  const rule = ROLE_RULES.find((candidate) => routeMatches(candidate, path, method));
  if (rule === undefined || rule.roles.length === 0) return undefined;
  if (rule.roles.some((role) => roles.includes(role))) return undefined;
  const upper = method.toUpperCase();
  const isRead = upper === "GET" || upper === "HEAD";
  return roles.includes("Platform Admin") && isRead ? undefined : ROLE_FORBIDDEN_DETAIL;
};

/**
 * What this layer can and cannot check. It reads the `siteId`, `sourceSiteId` and `destinationSiteId` keys of the query
 * and the body. It does not resolve a `siteCode` (the identity context carries site ids only; the import bodies name
 * sites by code, so the owning service checks those rows), and it does not load a record named by an id in the path:
 * a by-id route is checked against the record's site by the owning service, before it writes.
 */
const SITE_ID_KEYS: Record<string, true> = { siteId: true, sourceSiteId: true, destinationSiteId: true };

/**
 * The site ids a payload names that lie outside `allowedSiteIds`. A transfer names one site at each end and belongs to
 * either end's scope, so a source/destination pair is judged as a whole; every other site field has to match on its own.
 */
export const findOutOfScopeSiteIds = (value: unknown, allowedSiteIds: readonly string[]): string[] => {
  const offenders = new Set<string>();
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!current || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    const source = record.sourceSiteId;
    const destination = record.destinationSiteId;
    if (typeof source === "string" && typeof destination === "string") {
      if (!allowedSiteIds.includes(source) && !allowedSiteIds.includes(destination)) {
        offenders.add(source);
        offenders.add(destination);
      }
      for (const [key, child] of Object.entries(record)) {
        if (key === "sourceSiteId" || key === "destinationSiteId") continue;
        visit(child);
      }
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (SITE_ID_KEYS[key] === true && typeof child === "string" && child.trim().length > 0) {
        const siteId = child.trim();
        if (!allowedSiteIds.includes(siteId)) offenders.add(siteId);
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return [...offenders];
};

export const verifyInternalIdentityContext = (
  header: string | undefined,
  secret: string | undefined,
  now = new Date(),
  expectedAudience?: string | string[],
): InternalIdentityContext | undefined => {
  if (!header || !secret) return undefined;
  try {
    const rawJson = Buffer.from(header, "base64url").toString("utf8");
    const signed = signedInternalIdentityContextSchema.parse(JSON.parse(rawJson));
    const serialized = JSON.stringify(signed.context);
    const expected = createHmac("sha256", secret).update(serialized).digest("hex");
    const expectedBytes = Buffer.from(expected, "utf8");
    const providedBytes = Buffer.from(signed.signature, "utf8");
    if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) {
      return undefined;
    }
    const context = internalIdentityContextSchema.parse(signed.context);
    if (new Date(context.expiresAt).getTime() <= now.getTime()) {
      return undefined;
    }
    if (new Date(context.issuedAt).getTime() > now.getTime()) {
      return undefined;
    }
    if (expectedAudience !== undefined) {
      const allowedAudiences = Array.isArray(expectedAudience) ? expectedAudience : [expectedAudience];
      if (!allowedAudiences.includes(context.audience)) {
        return undefined;
      }
    }
    return context;
  } catch {
    return undefined;
  }
};

export const signInternalIdentityContext = (context: InternalIdentityContext, secret: string): string => {
  const serialized = JSON.stringify(context);
  const signature = createHmac("sha256", secret).update(serialized).digest("hex");
  const signed: SignedInternalIdentityContext = {
    context,
    algorithm: "hmac-sha256",
    signature,
  };
  return Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
};

const injectDefaultSiteQuery = (request: Request, siteId: string): void => {
  if (request.query.siteId !== undefined) return;
  const requestUrl = new URL(request.originalUrl || request.url, "http://service.internal");
  requestUrl.searchParams.set("siteId", siteId);
  request.url = `${requestUrl.pathname}${requestUrl.search}`;
};

/** Carries a site-scoped employee's assigned sites from this middleware to the route handlers. */
export const ACTOR_SITE_IDS_HEADER = "x-actor-site-ids";

/** Actor types whose `?siteId=` is trusted: an employee narrows to one of their own sites, a service acts for one. */
const QUERY_SITE_SCOPE_ACTORS: readonly string[] = ["employee", "system"];

/** The scope the trusted layer assigned: an employee's sites, an internal service's forwarded scope, else undefined. */
export const actorSiteIds = (request: Request): string[] | undefined => {
  const scope = request.header(ACTOR_SITE_IDS_HEADER);
  return scope === undefined ? undefined : scope.split(",").filter((siteId) => siteId.length > 0);
};

/**
 * The sites a list read may return: the requested `siteId`, which the middleware already denied when it lies outside
 * the caller's scope; otherwise every site assigned to a site-scoped employee, which is empty when none is assigned;
 * otherwise `undefined`, meaning no site restriction (Platform Admin, internal services, shoppers). A shopper's query
 * is never honoured, because a shopper's rows are already narrowed to their own records by the owner filter.
 */
export const listSiteIds = (request: Request): string[] | undefined => {
  const actorType = request.header("x-actor-type");
  if (actorType !== undefined && QUERY_SITE_SCOPE_ACTORS.includes(actorType)) {
    const requested = typeof request.query.siteId === "string" ? request.query.siteId.trim() : "";
    if (requested) return [requested];
  }
  return actorSiteIds(request);
};

const interceptResponseForSiteSecurity = (response: Response, allowedSiteIds: string[]): void => {
  const originalJson = response.json.bind(response);
  const originalSend = response.send.bind(response);
  let handled = false;

  response.json = function (body: unknown) {
    if (handled) {
      return originalJson(body);
    }
    if (findOutOfScopeSiteIds(body, allowedSiteIds).length > 0) {
      handled = true;
      return response.status(403).json({
        title: "Site access denied",
        status: 403,
        code: "site_access_denied",
      });
    }
    return originalJson(body);
  };

  response.send = function (body: unknown) {
    if (handled) {
      return originalSend(body);
    }
    let parsed: unknown;
    if (typeof body === "string") {
      try {
        parsed = JSON.parse(body);
      } catch {
        // Non-JSON string, pass through
      }
    } else if (Buffer.isBuffer(body)) {
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        // Non-JSON buffer, pass through
      }
    } else if (typeof body === "object" && body !== null) {
      parsed = body;
    }

    if (parsed !== undefined && findOutOfScopeSiteIds(parsed, allowedSiteIds).length > 0) {
      handled = true;
      return response.status(403).json({
        title: "Site access denied",
        status: 403,
        code: "site_access_denied",
      });
    }

    return originalSend(body);
  };
};

export const createTrustedRequestMiddleware = (options: TrustedRequestEnforcementOptions = {}): RequestHandler => {
  const healthPrefixes = options.healthPaths ?? DEFAULT_HEALTH_PREFIXES;
  const publicPrefixes = options.publicPaths ?? [];
  const siteScopedPrefixes = [...DEFAULT_SITE_SCOPED_PREFIXES, ...(options.siteScopedPaths ?? [])];

  return (request: Request, response: Response, next: NextFunction): void => {
    const isHealth = healthPrefixes.some((prefix) => matchesPathPrefix(request.path, prefix));
    const isPublic =
      publicPrefixes.some((prefix) => matchesPathPrefix(request.path, prefix)) ||
      (options.isPublic ? options.isPublic(request) : false);

    const identitySecret = options.identitySecret ?? process.env.INTERNAL_IDENTITY_SECRET;
    const serviceSecret = options.serviceSecret ?? process.env.INTERNAL_SERVICE_SECRET;
    const expectedAudience = options.expectedAudience ?? process.env.INTERNAL_IDENTITY_AUDIENCE;

    const rawIdentityHeader = request.header("x-internal-identity-context");
    const verifiedContext = verifyInternalIdentityContext(
      rawIdentityHeader,
      identitySecret,
      new Date(),
      expectedAudience,
    );

    const rawServiceSecret = request.header("x-internal-service-secret");
    const isServiceSecretValid =
      Boolean(serviceSecret) && Boolean(rawServiceSecret) && rawServiceSecret === serviceSecret;

    if (!isHealth && !isPublic && !verifiedContext && !isServiceSecretValid) {
      response.status(401).json({
        title: "Trusted gateway request required",
        status: 401,
        code: "trusted_request_required",
      });
      return;
    }

    // A repeated `siteId` parses to an array, which every site filter would silently ignore, so it is refused rather
    // than read as "no filter" and left to widen the result set.
    if (!isHealth && request.query.siteId !== undefined && typeof request.query.siteId !== "string") {
      response.status(400).json({
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
      });
      return;
    }

    if (verifiedContext) {
      // Lets an operator find the trace of a request from the correlation id shown to a user (System page, Traces).
      const span = trace.getActiveSpan();
      span?.setAttribute("correlation_id", verifiedContext.correlationId);
      span?.setAttribute("request_id", verifiedContext.requestId);
      if (verifiedContext.actorId) {
        request.headers["x-actor-id"] = verifiedContext.actorId;
      } else {
        delete request.headers["x-actor-id"];
      }
      request.headers["x-actor-type"] = verifiedContext.actorType;
      request.headers["x-request-id"] = verifiedContext.requestId;
      request.headers["x-correlation-id"] = verifiedContext.correlationId;
      // Route handlers see the roles of an employee only; a shopper or anonymous caller has none to carry.
      if (verifiedContext.actorType === "employee") {
        request.headers[ACTOR_ROLES_HEADER] = verifiedContext.roles.join(",");
      } else {
        delete request.headers[ACTOR_ROLES_HEADER];
      }
    } else if (isServiceSecretValid) {
      if (!request.headers["x-actor-type"]) {
        request.headers["x-actor-type"] = "system";
      }
    } else {
      // Neither a verified context nor a service secret: the caller is a public client, so nothing it sent may name an actor.
      if (request.headers["x-actor-id"] !== undefined) {
        logger.warn(
          { requestId: request.header("x-request-id"), path: request.path },
          "dropped client actor headers without verified identity context",
        );
      }
      delete request.headers["x-actor-id"];
      delete request.headers["x-actor-type"];
      delete request.headers[ACTOR_ROLES_HEADER];
    }

    // A shopper's own paths stay open; anything behind the counter stops here even though the context verifies.
    if (
      verifiedContext &&
      (verifiedContext.actorType === "customer" || verifiedContext.actorType === "anonymous") &&
      isEmployeePath(request.path, request.method)
    ) {
      response.status(403).json({
        title: "Employee access required",
        status: 403,
        code: "employee_required",
      });
      return;
    }

    // The roles a verified employee holds are checked here as the edge checks them: Platform Admin reads every
    // route and writes only where a rule names it, and any other employee needs one of the roles the rule names.
    if (verifiedContext && verifiedContext.actorType === "employee") {
      const detail = roleRefusal(request.path, request.method, verifiedContext.roles);
      if (detail !== undefined) {
        response.status(403).json({ title: "Role forbidden", status: 403, code: "role_forbidden", detail });
        return;
      }
    }

    // Only this middleware states an employee's sites, so a browser can never claim a scope. An internal service
    // calling without an identity context may forward the scope of the employee it acts for.
    if (verifiedContext || !isServiceSecretValid) delete request.headers[ACTOR_SITE_IDS_HEADER];

    if (
      verifiedContext &&
      verifiedContext.actorType === "employee" &&
      !verifiedContext.roles.includes("Platform Admin")
    ) {
      const employeeSiteIds = verifiedContext.siteIds ?? [];
      request.headers[ACTOR_SITE_IDS_HEADER] = employeeSiteIds.join(",");

      if (employeeSiteIds.length === 0) {
        const isSiteScoped = siteScopedPrefixes.some((prefix) => matchesPathPrefix(request.path, prefix));
        if (isSiteScoped) {
          response.status(403).json({
            title: "No site access assigned",
            status: 403,
            code: "site_access_denied",
          });
          return;
        }
      }

      if (
        employeeSiteIds.length === 1 &&
        siteScopedPrefixes.some((prefix) => matchesPathPrefix(request.path, prefix))
      ) {
        injectDefaultSiteQuery(request, employeeSiteIds[0] as string);
      }

      // A transfer spans two sites and belongs to either end's scope, so the pair is judged as a whole; the route then
      // writes or reads only rows the employee's sites take part in.
      const queryOffenders = findOutOfScopeSiteIds(request.query, employeeSiteIds);
      const bodyOffenders = findOutOfScopeSiteIds(request.body, employeeSiteIds);
      const requestedSiteIds = [...new Set([...queryOffenders, ...bodyOffenders])];

      if (requestedSiteIds.length > 0) {
        response.status(403).json({
          title: "Site access denied",
          status: 403,
          code: "site_access_denied",
        });
        return;
      }

      interceptResponseForSiteSecurity(response, employeeSiteIds);
    }

    next();
  };
};

export const trustedRequestMiddleware = createTrustedRequestMiddleware;
