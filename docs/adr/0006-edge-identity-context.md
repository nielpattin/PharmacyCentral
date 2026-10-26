# 0006. Edge-verified identity context forwarded to services

Status: Accepted

Date: 2026-09-10

## Context

Backend services need the caller's identity, roles, and sites, but they hold no session state. In AWS, an API Gateway HTTP API runs a REQUEST Lambda authorizer (`deploy/aws/lambda/authorizer.mjs`, added in commit `121a585`, 2026-09-10). It resolves the session by calling identity-service `/auth/me` with the cookie, enforces the route policy in `deploy/aws/lambda/policy.mjs`, and signs an identity context. The local Compose stack has no authorizer. The repository does not record why identity-service also mints contexts locally. The comment in `trusted-request.ts` describes the local topology as one that "hands every shopper a signed context", but it does not give the reason. The rules are in [runbook.md](../runbook.md#edge-routing-and-security) and the contract is in [api-guide.md](../api-guide.md).

## Decision

- The edge is the only component that resolves a browser session for a backend call. It sets four headers from its own result: `x-internal-identity-context`, `x-actor-id`, `x-actor-type`, and `x-request-id`. The integration's `overwrite:header.*` parameters replace any client value on `/api/{proxy+}` (`aws_apigatewayv2_integration.services` in `deploy/aws/main.tf`).
- The context is JSON signed with HMAC-SHA256 under `INTERNAL_IDENTITY_SECRET`. It carries the actor id and type, roles, site ids, request and correlation ids, audience, and a 30-second expiry (`deploy/aws/lambda/identity.mjs`, `deploy/aws/lambda/authorizer.mjs`).
- Each service verifies the signature with `timingSafeEqual`, then the expiry, the issue time, and that the audience is its own name (`apps/*/src/middleware/trusted-request.ts`; identity-service sets `expectedAudience: serviceName`). It copies `x-actor-id`, `x-actor-type`, and `x-request-id` from the verified context, and deletes `x-actor-id` when the context has none. Without a valid context it answers `401 trusted_request_required`, unless the path is public or a health check, or the request carries a valid `x-internal-service-secret`.
- identity-service signs the same format on `GET /api/auth/context` for seven audiences, with a 5-minute expiry (`apps/identity-service/src/modules/accounts/presentation/http/account-routes.ts`). The web apps attach these tokens (`apps/customer-web/src/customer-api.ts`, `apps/staff-web/src/staff-api.ts`). At the edge the overwrite replaces them. Locally they are the only context.
- Locally the nginx gateway neither validates sessions nor overwrites identity headers. The services enforce the route rules themselves: `isEmployeePath` and `DEFAULT_EMPLOYEE_PREFIXES` in `trusted-request.ts` restate `policy.mjs`, and `credential-routes.ts` checks Platform Admin directly.

## Consequences

- The shared secret is the root of trust. Whoever holds `INTERNAL_IDENTITY_SECRET` can mint any identity. The authorizer reads it from Secrets Manager (`deploy/aws/lambda/secrets.mjs`, `authorizer_secret_arns` in `deploy/aws/main.tf`). [observed]
- A signed context can be replayed until it expires: 30 seconds from the authorizer, 5 minutes from `/auth/context`. The verifier keeps no nonce store. [observed]
- The local topology depends on the route rules copied into several services. Drift between `trusted-request.ts` and `policy.mjs` is caught only where a test compares them, for example the platform-admin list in `apps/ops-console-service/src/modules/system/route-table.test.ts`. [observed]
- Anonymous callers on public routes get a context with `actorType` `system` and no actor id (the default in `identity.mjs`). Services that test for `system`, such as `readsEveryOrder` in sales-service, rely on the route policy keeping anonymous callers off their paths. [observed]
- Locally, a client's own `x-actor-id` or `x-actor-type` survives on a public route that carries no context, because the trusted middleware overwrites those headers only when a context verifies. In AWS the overwrite removes them first. [observed]
- The SePay webhook route bypasses the authorizer. Its integration overwrites only the path and `x-request-id` (`aws_apigatewayv2_integration.sepay_webhook`), and the webhook handler does not read identity headers. [observed]
- Each authenticated request makes one identity-service call from the authorizer, with a 3-second timeout after which the request is denied (`IDENTITY_LOOKUP_TIMEOUT_MS`). [observed]
- No AWS resources were deployed (README.md), so the edge path has not run in AWS.

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-AUTH-002 to BR-AUTH-006 (role matrix, site scope, actor identity, customers), BR-AUTH-008 (trusted context required).
