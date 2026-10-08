import { randomUUID } from "node:crypto";

import {
  employeeRolesForRequest,
  isAuthRoute,
  isCsrfExempt,
  isEmployeeRoleAllowed,
  isEmployeeRoute,
  isOptionalIdentityRoute,
  isPublicRoute,
  isSiteScopedListRoute,
  normalizeApiPath,
  selectTargetService,
} from "./policy.mjs";
import { createIdentityContext, encodeSignedIdentityContext, signIdentityContext } from "./identity.mjs";
import { extractHeader, validateCsrfToken } from "./csrf.mjs";
import { createSecretsResolver } from "./secrets.mjs";

const deny = () => ({
  isAuthorized: false,
  context: {},
});

const allow = (signedIdentityContext, identity) => ({
  isAuthorized: true,
  context: {
    signedIdentityContext,
    actorId: identity?.id ?? "",
    actorType: identity?.actorType ?? "system",
  },
});

const extractEventDetails = (event = {}) => {
  const path = event.rawPath || event.requestContext?.http?.path || event.path || "/";
  const method = (event.requestContext?.http?.method || event.httpMethod || "GET").toUpperCase();
  const headers = event.headers || {};

  let cookieHeader = extractHeader(headers, "cookie");
  if (!cookieHeader && Array.isArray(event.cookies) && event.cookies.length > 0) {
    cookieHeader = event.cookies.join("; ");
  }

  const queryStringParameters = { ...(event.queryStringParameters || {}) };
  if (event.rawQueryString && Object.keys(queryStringParameters).length === 0) {
    try {
      const searchParams = new URLSearchParams(event.rawQueryString);
      for (const [key, value] of searchParams.entries()) {
        queryStringParameters[key] = value;
      }
    } catch {
      // Ignore URLSearchParams parsing failure
    }
  }

  const requestId = extractHeader(headers, "x-request-id") || event.requestContext?.requestId || randomUUID();

  const correlationId = extractHeader(headers, "x-correlation-id") || requestId;

  return {
    path,
    method,
    headers,
    cookieHeader,
    queryStringParameters,
    requestId,
    correlationId,
  };
};

export const createAuthorizerHandler = (options = {}) => {
  const identityServiceUrl = options.identityServiceUrl ?? process.env.IDENTITY_SERVICE_URL ?? "http://localhost:3001";
  const defaultAudience = options.defaultAudience ?? process.env.INTERNAL_IDENTITY_AUDIENCE;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const nowFn = options.nowFn ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? (Number(process.env.IDENTITY_SERVICE_TIMEOUT_MS) || 3000);
  const ttlMs = options.ttlMs ?? 30_000;

  const secretsResolver =
    options.secretsResolver ??
    createSecretsResolver({
      secretsClient: options.secretsClient,
      fetchSecret: options.fetchSecret ?? options.getSecretValue,
      cache: options.secretsCache ?? options.cache,
      awsRegion: options.awsRegion,
      sdkLoader: options.sdkLoader,
    });

  return async (event = {}) => {
    try {
      const rawIdentitySecret =
        options.internalIdentitySecret ??
        options.internalIdentitySecretArn ??
        process.env.INTERNAL_IDENTITY_SECRET ??
        process.env.INTERNAL_IDENTITY_SECRET_ARN;

      const rawServiceSecret =
        options.internalServiceSecret ??
        options.internalServiceSecretArn ??
        process.env.INTERNAL_SERVICE_SECRET ??
        process.env.INTERNAL_SERVICE_SECRET_ARN ??
        "";

      let internalIdentitySecret;
      let internalServiceSecret;

      try {
        internalIdentitySecret =
          typeof secretsResolver === "function"
            ? await secretsResolver(rawIdentitySecret, "INTERNAL_IDENTITY_SECRET")
            : await secretsResolver.resolveSecret(rawIdentitySecret, "INTERNAL_IDENTITY_SECRET");

        internalServiceSecret =
          typeof secretsResolver === "function"
            ? await secretsResolver(rawServiceSecret, "INTERNAL_SERVICE_SECRET")
            : await secretsResolver.resolveSecret(rawServiceSecret, "INTERNAL_SERVICE_SECRET");
      } catch (secretErr) {
        console.error("Failed to resolve authorizer secrets:", secretErr);
        return deny();
      }

      if (!internalIdentitySecret) {
        console.error("Missing INTERNAL_IDENTITY_SECRET in authorizer configuration");
        return deny();
      }

      const { path, method, headers, cookieHeader, queryStringParameters, requestId, correlationId } =
        extractEventDetails(event);

      // 1. CSRF validation for non-exempt mutating requests
      if (!isCsrfExempt(path, method)) {
        if (!validateCsrfToken(cookieHeader, headers)) {
          return deny();
        }
      }

      // 2. Route classification
      const normPath = normalizeApiPath(path);
      const isPublic = isPublicRoute(normPath);
      const optionalIdentity = isOptionalIdentityRoute(normPath);
      const isAuth = isAuthRoute(normPath);
      const needsEmployee = isEmployeeRoute(normPath, method);

      let identity;

      // 3. Authentication & Session resolution
      if (!isAuth && (!isPublic || optionalIdentity || needsEmployee)) {
        if (!cookieHeader && !optionalIdentity) {
          return deny();
        }

        if (cookieHeader) {
          try {
            const reqHeaders = {
              cookie: cookieHeader,
              "x-request-id": requestId,
            };
            if (internalServiceSecret) {
              reqHeaders["x-internal-service-secret"] = internalServiceSecret;
            }

            const identityResponse = await fetchFn(`${identityServiceUrl}/auth/me`, {
              method: "GET",
              headers: reqHeaders,
              signal: AbortSignal.timeout(timeoutMs),
            });

            if (identityResponse.ok) {
              identity = await identityResponse.json();
            } else if (identityResponse.status === 401) {
              if (!optionalIdentity) {
                return deny();
              }
              identity = undefined;
            } else {
              // 5xx or unexpected status from identity-service
              return deny();
            }
          } catch {
            // Identity service unreachable / timeout
            return deny();
          }
        }
      }

      // 4. Employee authorization policy
      // A route can serve both audiences: any signed-in account may read the prescription list, but a staff caller
      // sees every record instead of only their own, so the role that route requires still applies to staff.
      const requiredRoles = employeeRolesForRequest(normPath, method);
      const requiresStaffRole = identity?.actorType === "employee" && (requiredRoles?.length ?? 0) > 0;
      if (needsEmployee || requiresStaffRole) {
        if (!identity || identity.actorType !== "employee") {
          return deny();
        }

        const roles = Array.isArray(identity.roles) ? identity.roles : [];
        if (!isEmployeeRoleAllowed(roles, requiredRoles)) {
          return deny();
        }

        // Site checks for non-Platform Admin
        if (!roles.includes("Platform Admin")) {
          const siteIds = Array.isArray(identity.siteIds) ? identity.siteIds : [];

          // Query parameter site check
          const querySiteId = queryStringParameters?.siteId;
          if (querySiteId && !siteIds.includes(querySiteId)) {
            return deny();
          }

          // Site-scoped list route check (must have at least one assigned site)
          if (isSiteScopedListRoute(normPath) && siteIds.length === 0) {
            return deny();
          }
        }
      }

      // 5. Generate Signed Internal Identity Context
      const now = nowFn();
      const audience = defaultAudience || selectTargetService(normPath);
      const identityContext = createIdentityContext({
        requestId,
        correlationId,
        identity,
        audience,
        now,
        ttlMs,
      });

      const signed = signIdentityContext(identityContext, internalIdentitySecret);
      const encodedSignedContext = encodeSignedIdentityContext(signed);

      return allow(encodedSignedContext, identity);
    } catch (err) {
      console.error("Unhandled authorizer error:", err);
      return deny();
    }
  };
};

export const handler = createAuthorizerHandler();
export const authorizerHandler = handler;
