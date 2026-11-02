# 0003. Strip client actor headers and add the anonymous actor type
<!-- anchor: 0003-harden-the-guest-cart-cookie-and-edge-identity-headers -->

- **Status:** Implemented
- **Author:** TBD (unclaimed)
- **Date:** 2026-10-26

## Summary

Services take the caller's identity from a verified access token ([ADR 0006](../adr/0006-jwt-access-tokens-verified-by-every-service.md), [ADR 0021](../adr/0021-es256-jwt-access-tokens.md)) and read it from the `x-actor-id`, `x-actor-type`, `x-actor-roles` and `x-actor-site-ids` request headers that the trusted layer sets. A header a client sends under one of those names must never reach a handler. This design drops client actor headers at every layer: both local gateways, the `trusted-request.ts` of each service, and the SePay webhook route. It also gives a caller with no account the actor type `anonymous`, so that such a caller is never read as `system`. It affects the seven `trusted-request.ts` copies, the `src/contracts/common.ts` of the services that declare an actor type, payment-service, and the two local nginx gateways.

## Motivation

Evidence from code read on 2026-10-26; nothing was run.

**(a) Actor headers on public routes.** A trusted layer that overwrites `x-actor-id` and `x-actor-type` only when a token verifies lets the client's own values through on a public request that carries no token and no valid service secret. The same logic is copied in seven services (`apps/{catalog,chatbot,identity,inventory,operations-query,payment,sales}-service/src/middleware/trusted-request.ts`). A handler that reads `x-actor-id` on a public route would then act for whatever actor the client names. The local gateways would not help: `deploy/local/gateway/nginx.conf` and `nginx.dev.conf.template` set `Host`, `Connection` and `X-Forwarded-For`, and `routes.conf` sets no `proxy_set_header`. On AWS the API Gateway integration keeps only `overwrite:path` and `overwrite:header.x-request-id` on `/api/{proxy+}` (`deploy/aws/main.tf`), so the services are the only guard there.

**(b) Anonymous callers.** The actor type of a caller with no account must not equal a type that services trust. Services trust `system` (internal calls with `x-internal-service-secret`) and `employee`: the audit skip, the inventory service-only routes and the site-scope checks key on them.

**(c) SePay webhook.** The webhook route is registered before the trusted layer in `apps/payment-service/src/main.ts`, and the handler reads only `x-sepay-*` headers. There is no exploit. It is a hygiene gap that holds only while the handler never reads identity headers.

| Exposure | Local (Compose gateway) | AWS |
|---|---|---|
| Client `X-Actor-Id`, `X-Actor-Type`, `X-Actor-Site-Ids` | Removed by nginx, then dropped by the service | Dropped by the service |
| Actor type of a caller with no account | `anonymous` | `anonymous` |
| Identity headers on the webhook route | Removed by the route | Removed by the route |

## Goals

- Neither local gateway forwards client `X-Actor-Id`, `X-Actor-Type` or `X-Actor-Site-Ids` to a service.
- A request with no verified token and no valid service secret reaches all seven services with no `x-actor-id`, `x-actor-type`, roles header or site-ids header.
- `anonymous` is a valid actor type in the service contracts, and no service treats it as `system` or `employee`.
- The SePay webhook handler never sees an identity header.

## Non-goals

- Changing the access token claims ([ADR 0021](../adr/0021-es256-jwt-access-tokens.md)).
- Extracting one shared trusted-request module (see Alternatives).

## Proposed design

### Contracts

`actorType` is `z.enum(["anonymous", "customer", "employee", "system"])` in `src/contracts/common.ts`. `createAccessTokenVerifier` of `@pharmacy/auth` reads a token without an `actorType` claim as `anonymous` (`packages/auth/src/access-token.ts`). No route or path-prefix change, so `routes.conf` and the `path_rules` in `main.tf` are untouched. Existing equality checks are unchanged, and `anonymous` matches none of the `employee` or `system` checks.

### Local gateways

In the server block of `deploy/local/gateway/nginx.conf` and `nginx.dev.conf.template`, beside the existing `proxy_set_header` lines: `proxy_set_header X-Actor-Id "";`, `proxy_set_header X-Actor-Type "";`, `proxy_set_header X-Actor-Site-Ids "";`. An empty value makes nginx omit the header. `routes.conf` defines no `proxy_set_header`, so the server-level lines apply to its locations. `Authorization` is not touched and reaches the service.

### Services: fail closed on actor headers

In each of the seven `trusted-request.ts` copies, when no token verifies and no service secret is valid, the middleware deletes `x-actor-id` and `x-actor-type` (and the roles and site-ids headers) before `next()`. Calls between services keep their secret path (`x-internal-service-secret`).

### SePay webhook

`apps/payment-service/src/middleware/strip-identity-headers.ts` deletes `x-actor-id`, `x-actor-type` and `x-actor-site-ids`, and `main.ts` runs it first on `POST /payments/sepay/webhook`. The API Gateway integration for the webhook overwrites only the path and `x-request-id`, so the service-side deletion is the guarantee.

### Data model, Events

None.

### Security
<!-- anchor: security-and-csrf -->

No new secret and no new environment variable. The token is verified in each service as [ADR 0006](../adr/0006-jwt-access-tokens-verified-by-every-service.md) describes; this design only guarantees that nothing a client sends can stand in for it. No route authenticates with a cookie, so no CSRF token exists ([ADR 0005](../adr/0005-jwt-only-authentication-no-sessions-or-csrf.md), [ADR 0021](../adr/0021-es256-jwt-access-tokens.md)).

### Observability

A `warn` log with `requestId` when the trusted layer drops a client `x-actor-id` from a request with no verified token. It should stay at zero on AWS, and fall to zero locally once the gateway change is live.

## Alternatives considered

- **Gateway-only stripping.** Insufficient: direct service calls (tests, `order-stock-proof.mjs`) bypass nginx, and API Gateway does not strip these headers, so services must fail closed too.
- **One shared trusted-request package.** Removes the seven-copy drift ADR 0006 notes, but is a larger refactor. Deferred (Open questions).
- **Overwriting the headers at API Gateway.** The service-side deletion is required anyway, so extra `overwrite:header` mappings add configuration and no guarantee.

## Rollout and migration

1. Services first: the contracts accept `anonymous`, the seven trusted-layer copies fail closed, and the webhook middleware lands. Verified requests are unaffected.
2. Gateways: restart `gateway` or `gateway-dev` only. `nginx.conf` and `routes.conf` are bind-mounted, so no image rebuild is needed.

Compatibility: `.agents/skills/verify-pharmacy-central/scripts/order-stock-proof.mjs` calls services directly with the internal secret and is unaffected by gateway stripping.

## Testing

- **trusted-request** (each copy): a request with `x-actor-id` and `x-actor-type` but no token reaches the handler with both absent; with a valid service secret they are kept; with a valid token they are overwritten.
- **payment-service**: `strip-identity-headers.test.ts` asserts the identity headers are removed before the handler runs.
- **Smoke** (`tools/edge-identity-smoke.mjs` against `API_BASE_URL`): `GET /api/carts` with a random `X-Actor-Id` and no bearer token answers `401 trusted_request_required` and sets no cookie; `POST /api/carts/merge` with no token answers `401 trusted_request_required`.

## Open questions

- One shared trusted-request module versus seven copies (ADR 0006 drift)? Architecture owner.

## Related ADRs

- [0006](../adr/0006-jwt-access-tokens-verified-by-every-service.md): the verification this design protects.
- [0007](../adr/0007-gateway-path-routing-and-two-topologies.md): gateway changes stay in server blocks and `routes.conf` is untouched.
- [0021](../adr/0021-es256-jwt-access-tokens.md): the access token and its claims.
- Business rules: BR-AUTH-005 and BR-AUTH-008 in [business-rules.md](../business-rules.md). Operations: [runbook.md](../runbook.md#edge-routing-and-security). Contract: [api-guide.md](../api-guide.md).
