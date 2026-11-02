# 0006. JWT access tokens verified by every service

Status: Accepted

Date: 2026-09-10

## Context

Backend services need the caller's identity, roles, and sites, but they hold no per-caller state. The browser holds one JWT access token that identity-service issued ([ADR 0005](0005-jwt-only-authentication-no-sessions-or-csrf.md), [ADR 0021](0021-es256-jwt-access-tokens.md)). The edge, an Nginx gateway locally and an API Gateway HTTP API in AWS, only routes: it resolves no caller and signs nothing. The same token reaches every service, so the same verification runs in the local and the AWS topology. The rules are in [runbook.md](../runbook.md#edge-routing-and-security) and the contract is in [api-guide.md](../api-guide.md).

## Decision

- The browser sends `Authorization: Bearer <access token>` on every call to a service. Both edges forward that header untouched. The API Gateway integration keeps only `overwrite:path` and `overwrite:header.x-request-id` on `/api/{proxy+}` (`aws_apigatewayv2_integration.services` in `deploy/aws/main.tf`). The local gateways clear client-supplied `X-Actor-Id`, `X-Actor-Type` and `X-Actor-Site-Ids` (`deploy/local/gateway/nginx.conf`).
- Each service verifies the token itself in `apps/*/src/middleware/trusted-request.ts`, through `createAccessTokenVerifier` of `@pharmacy/auth`. The verifier checks the ES256 signature against the identity-service JWKS (`IDENTITY_JWKS_URL`, required), the issuer `pharmacy-central`, the audience `pharmacy-api` and the expiry.
- From a valid token the service sets `x-actor-id`, `x-actor-type`, `x-actor-roles` and the site ids on the request, and always overwrites or deletes any client-supplied value of those headers. Code below the middleware reads those fields and never the token.
- Without a valid token the request is anonymous. On a public path or a health check it proceeds with `x-actor-id` and `x-actor-type` removed. On any other path the service answers `401 trusted_request_required`, unless the request carries a valid `x-internal-service-secret` (calls between services with no user).
- A valid token for an account that must change its password carries `pcr: true`. Every service refuses it with `403 password_change_required`, except on the identity-service auth routes.
- A service that calls another service for a user forwards the caller `Authorization` header. A call with no user uses `x-internal-service-secret`.
- The route rules (public paths, employee prefixes, role rules, site rules) live in the `trusted-request.ts` of each service and are enforced there ([ADR 0017](0017-roles-checked-in-every-service.md)). `credential-routes.ts` checks Platform Admin directly.

## Consequences

- The private signing key is the root of trust, and only identity-service holds it (`ACCESS_TOKEN_PRIVATE_KEY`). Other services hold no secret for user identity; they fetch the public key set. [observed]
- A token can be replayed until it expires, at most one day. The verifier keeps no nonce store and no revocation list, so a token lives out its lifetime whatever happens to the account. [observed]
- A service that cannot reach the JWKS endpoint cannot verify a token signed by a key it has not cached. The verifier caches the key set and refetches it when it meets an unknown key id. [INFERENCE]
- The route rules are copied into several services. Drift between the copies is caught only where a test compares them, for example the platform-admin list in `apps/ops-console-service/src/modules/system/route-table.test.ts`. [observed]
- Anonymous callers on public routes carry no actor id. No service treats `anonymous` as `employee` or `system`. A request with no verified token and no service secret reaches a service with `x-actor-id`, `x-actor-type`, the roles header and the site-ids header removed.
- The SePay webhook route carries no token. Its integration overwrites only the path and `x-request-id` (`aws_apigatewayv2_integration.sepay_webhook`), and the webhook handler does not read identity headers. [observed]
- No AWS resources were deployed (README.md), so the AWS path has not run in AWS.

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-AUTH-002 to BR-AUTH-006 (role matrix, site scope, actor identity, customers), BR-AUTH-008 (verified token required).
