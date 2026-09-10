import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import {
  internalIdentityContextSchema,
  signedInternalIdentityContextSchema,
  type InternalIdentityContext,
  type SignedInternalIdentityContext,
} from "../contracts/common.ts";

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
  "/inventory/balances",
  "/inventory/movements",
  "/inventory/transfers",
  "/inventory/stocktakes",
  "/inventory/returns",
  "/inventory/replenishment",
  "/inventory/adjustments",
  "/dashboard/summary",
  "/operations/dashboard",
  "/finance/summary",
  "/operations/finance",
  "/reports",
  "/audit/logs",
  "/operations/audit",
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

export const extractSiteIds = (value: unknown): string[] => {
  const ids = new Set<string>();
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }
    if (!current || typeof current !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (
        (key === "siteId" || key === "sourceSiteId" || key === "destinationSiteId") &&
        typeof child === "string" &&
        child.trim().length > 0
      ) {
        ids.add(child.trim());
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return [...ids];
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

const interceptResponseForSiteSecurity = (response: Response, allowedSiteIds: string[]): void => {
  const originalJson = response.json.bind(response);
  const originalSend = response.send.bind(response);
  let handled = false;

  const isUnauthorized = (payload: unknown): boolean => {
    const siteIds = extractSiteIds(payload);
    return siteIds.some((id) => !allowedSiteIds.includes(id));
  };

  response.json = function (body: unknown) {
    if (handled) {
      return originalJson(body);
    }
    if (isUnauthorized(body)) {
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

    if (parsed !== undefined && isUnauthorized(parsed)) {
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

    if (verifiedContext) {
      if (verifiedContext.actorId) {
        request.headers["x-actor-id"] = verifiedContext.actorId;
      } else {
        delete request.headers["x-actor-id"];
      }
      request.headers["x-actor-type"] = verifiedContext.actorType;
      request.headers["x-request-id"] = verifiedContext.requestId;
      request.headers["x-correlation-id"] = verifiedContext.correlationId;
    } else if (isServiceSecretValid) {
      if (!request.headers["x-actor-type"]) {
        request.headers["x-actor-type"] = "system";
      }
    }

    if (
      verifiedContext &&
      verifiedContext.actorType === "employee" &&
      !verifiedContext.roles.includes("Platform Admin")
    ) {
      const employeeSiteIds = verifiedContext.siteIds ?? [];

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

      const querySiteIds = extractSiteIds(request.query);
      const bodySiteIds = extractSiteIds(request.body);
      const requestedSiteIds = [...new Set([...querySiteIds, ...bodySiteIds])];

      if (requestedSiteIds.some((siteId) => !employeeSiteIds.includes(siteId))) {
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
