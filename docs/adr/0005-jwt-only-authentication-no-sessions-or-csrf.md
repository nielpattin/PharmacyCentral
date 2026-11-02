# 0005. JWT-only authentication, no sessions or CSRF

Status: Accepted

Date: 2026-09-10

## Context

Browsers sign in to `identity-service`, which owns accounts and issues the one credential every service accepts: the ES256 JWT access token described in [ADR 0021](0021-es256-jwt-access-tokens.md). The identity-service microservice landed in `8e7005f` (2026-09-10). The repository does not record why an opaque token was first considered over a signed one. The rate limit on credential routes landed later, in `fa213ee` (2026-10-24), and is part of this decision. The rules are in [AGENTS.md](../../AGENTS.md) (under "Architecture and service boundaries"); the contract is in [api-guide.md](../api-guide.md) and [runbook.md](../runbook.md).

## Decision

- Authentication is one JWT access token valid for one day. There is no refresh token, no session cookie, no `sessions` table and no CSRF token. identity-service stores no per-sign-in state.
- A sign-in (login, register, verify-email, password reset, change-password, setup-admin) answers the account profile with `accessToken` and `accessTokenExpiresAt` (ISO) in the body and sets no authentication cookie. The Google callback redirects to the web app with `#access_token=<jwt>` in the URL fragment, so the token never reaches a server log. The short-lived `oauth_state` cookie of the Google flow is not an authentication credential.
- Browsers keep `{ token, expiresAt }` in `localStorage` under `pharmacy_access_token`, read it at start, and send `Authorization: Bearer <access token>` to every service (`packages/ui/src/access-token.ts`). A missing or expired token means the user is signed out. A `401` from a non-auth URL ends the session.
- Sign-out is client-side: the client discards the token. No route revokes anything.
- Revocation is by expiry, at most one day. Deactivating an account or changing a role takes effect when the token expires; `GET /api/auth/me` still reads the database. A password change answers a fresh token with `pcr` cleared.
- CSRF protection does not exist because no route authenticates with a cookie: a browser never attaches the bearer header by itself, so a cross-site request cannot ride the credential.
- The SePay webhook is the only route that carries no token. `apps/payment-service/src/modules/sepay/sepay-webhook-verifier.ts` checks an HMAC-SHA256 over `${timestamp}.${rawBody}` inside a 300-second replay window (commit `4087b52`).
- ~~An anonymous shopper's cart is keyed by the `pharmacy_guest_cart` cookie.~~ Superseded by [ADR 0014](0014-signed-out-cart-in-the-browser.md): the signed-out cart lives in the browser, `sales-service` sets no guest cookie, and `POST /api/carts/merge` takes the local lines in its body.
- Five credential routes are rate limited in Redis: login, register, request-password-reset, reset-password, and verify-email. The bucket is a sliding window keyed by the SHA-256 of the email (or account id) and the client address (`apps/identity-service/src/modules/accounts/infrastructure/redis-auth-rate-limiter.ts`). Only failed sign-ins count, because a successful login withdraws its attempt. A refusal answers `429 rate_limited` with `Retry-After`.
- If Redis cannot be read or written, the route answers `503 rate_limit_unavailable` before any credential is checked. The Redis client has a 500 ms command timeout (`apps/identity-service/src/bootstrap/dependencies.ts`). The limit settings have no defaults.

## Consequences

- A token can be used until it expires, at most one day, whatever happens to the account: sign-out, a password change, a password reset, a deactivation and a role change do not invalidate a token already issued. Services verify a token with the cached public key and make no call to identity-service per request ([ADR 0021](0021-es256-jwt-access-tokens.md)). [observed]
- A Postgres outage stops login and `GET /api/auth/me`. Calls with a still-valid access token keep working in the other services until it expires. [INFERENCE]
- A script injected into the page can read the token from `localStorage`; the one-day lifetime bounds the damage but a stolen token cannot be revoked earlier. [INFERENCE]
- No identity-service state, middleware or table exists for sessions or CSRF, and no other service and no gateway checks a CSRF header. [observed]
- Rate limiting fails closed. During a Redis outage the five routes answer 503, while `GET /api/auth/me` keeps working for a caller with a valid access token because the profile is read from Postgres (runbook). Locally the bucket may be per account rather than per client, and the AWS `TRUST_PROXY_HOPS` value is not yet verified (runbook).
- sales-service reuses the `rate_limit_unavailable` code for prescription photo intake, so a photo is never sent to the metered reader unmetered ([API Guide](../api-guide.md)).

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-AUTH-005 (actor from the token, not the body), BR-AUTH-008 (verified token required), BR-USER-009 (sign-in and token lifetime).
