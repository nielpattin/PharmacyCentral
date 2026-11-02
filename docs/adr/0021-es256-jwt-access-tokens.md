# 0021. One-day ES256 JWT access token

Status: Accepted

Date: 2026-11-01

## Context

Browsers call `/api/...` through a gateway, and the backend services need to know who is calling. The identity of the caller must reach every service the same way locally and in AWS, without a component at the edge that resolves the caller and without per-request state. Accounts belong to identity-service ([ADR 0005](0005-jwt-only-authentication-no-sessions-or-csrf.md)). How services verify the result is in [ADR 0006](0006-jwt-access-tokens-verified-by-every-service.md). The shared code is `packages/auth` (`@pharmacy/auth`).

## Decision

- identity-service issues a standard JWT access token signed with ES256. The claims are `sub` (actor id), `actorType`, `roles`, `siteIds`, `pcr` (true when the account must change its password), `jti`, `iat` and `exp`. The issuer is `pharmacy-central` and the audience is `pharmacy-api` (`packages/auth/src/access-token.ts`).
- The access token lives one working day (86 400 seconds). It is the only credential: there is no refresh token and no session.
- identity-service holds the private key (`ACCESS_TOKEN_PRIVATE_KEY`, `ACCESS_TOKEN_KEY_ID`) and publishes the public key at the unauthenticated `GET /.well-known/jwks.json` (`ACCESS_TOKEN_PUBLIC_JWK`). `pnpm run auth:keygen` (`tools/auth-keygen.mjs`) prints the three values for `.env`. Every other service sets `IDENTITY_JWKS_URL` and verifies tokens itself.
- A sign-in (login, register, verify-email, password reset, change-password, setup-admin) returns `accessToken` and `accessTokenExpiresAt` in the body and sets no authentication cookie. The Google callback redirects to the web app with the token in the URL fragment (`#access_token=<jwt>`).
- The browser keeps `{ token, expiresAt }` in `localStorage` under `pharmacy_access_token` (`packages/ui/src/access-token.ts`), reads it at start, and sends `Authorization: Bearer` to every service. One token serves all services. If the token is missing or expired, or a non-auth URL answers `401`, the user is signed out. Signing out clears the token; it is client-side only.
- Revocation is by expiry, at most one day. Deactivating an account or changing a role takes effect when the token expires; `GET /api/auth/me` still reads the database.
- No gateway authorizer exists. The edge forwards `Authorization` untouched ([ADR 0007](0007-gateway-path-routing-and-two-topologies.md)).

## Consequences

- A token already issued stays valid for up to one day, whatever happens to the account. [observed]
- The signer publishes one key, so a key rotation procedure is not defined in code. [INFERENCE]
- A script injected into the page can read the token from `localStorage` and use it until it expires. [INFERENCE]
- Services need network access to identity-service for the JWKS (`IDENTITY_JWKS_URL`). A missing value stops startup ([ADR 0010](0010-fail-fast-environment-configuration.md)).
- Calls from one service to another on behalf of a user forward the caller Authorization header. Calls with no user use `x-internal-service-secret`.

## Alternatives considered

- A short-lived access token with a refresh token and a database session (an opaque cookie, a `sessions` table and CSRF protection on the cookie routes). Rejected: it needs identity-service state, a cookie path that CSRF must guard, and a refresh loop in every client, for revocation that this system does not need beyond a one-day expiry.
- An HMAC-signed identity context built on a shared secret held by the edge, identity-service and every service. Rejected: anyone holding the secret can mint any identity, and every verifier would hold that secret. ES256 lets verifiers hold only the public key.
- A Lambda authorizer at API Gateway that resolves the caller and passes an identity context to the services. Rejected: it exists only in AWS, so the local stack needs a second way to carry identity; it adds a Lambda, its secrets and a round trip to identity-service for each call; and the route rules would be written twice.
- The API Gateway JWT authorizer. Rejected: it checks signature and claims only at API Gateway, so it does not serve the local gateway, and the services still need the claims and the role and site rules on their side.

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-AUTH-005 (actor from the token), BR-AUTH-008 (verified token required), BR-USER-009 (sign-in and token lifetime).
