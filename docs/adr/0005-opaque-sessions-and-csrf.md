# 0005. Opaque browser sessions and CSRF protection

Status: Accepted

Date: 2026-09-10

## Context

Browsers sign in to `identity-service`, which owns accounts and sessions. The sessions and the identity-service microservice landed in `8e7005f` (2026-09-10). The cookie-plus-CSRF approach first appeared in the earlier codebase in `8ea84ca` (2026-05-11). The repository does not record why an opaque token was chosen over a signed one. The rate limit on credential routes landed later, in `fa213ee` (2026-10-24), and is part of this decision. The rules are in [AGENTS.md](../../AGENTS.md) (CSRF rule under "Architecture and service boundaries"); the contract is in [api-guide.md](../api-guide.md) and [runbook.md](../runbook.md).

## Decision

- A sign-in sets `pharmacy_session`, an opaque random token of 32 bytes. The cookie is `HttpOnly; SameSite=Lax; Path=/`, lasts 7 days, and adds `Secure` when `NODE_ENV=production` (`apps/identity-service/src/modules/accounts/presentation/http/account-routes.ts`).
- The `sessions` table stores only a SHA-256 digest of the token (`token_digest`, unique), plus `expires_at` and `revoked_at` (`apps/identity-service/src/modules/sessions/infrastructure/drizzle-session-repository.ts`, `apps/identity-service/src/shared/infrastructure/schema.ts`). Logout revokes one session. A password change, a password reset, and an administrator reset revoke all of the account's sessions (`account-service.ts`).
- Browser mutations must send `X-CSRF-TOKEN` equal to the `pharmacy_csrf` cookie (double submit). `GET /api/auth/csrf` sets that cookie, which scripts can read, for one hour. `apps/identity-service/src/middleware/csrf.ts` compares the two values in constant time. The auth entry points are exempt: login, register, setup, verify-email, password reset, Google, and the csrf and context reads.
- The SePay webhook is the only exception. `apps/payment-service/src/modules/sepay/sepay-webhook-verifier.ts` checks an HMAC-SHA256 over `${timestamp}.${rawBody}` inside a 300-second replay window (commit `4087b52`).
- An anonymous shopper's cart is keyed by the `pharmacy_guest_cart` cookie, a random 24-byte token that `sales-service` sets for 30 days with `HttpOnly` and `SameSite=Lax`, plus `Secure` when `COOKIE_SECURE=true` (design 0003). It is re-issued on every guest cart response, and `POST /api/carts/merge` clears it. `POST /api/carts/merge` moves that cart into the account on sign-in (`apps/sales-service/src/modules/sales-routes.ts`).
- Five credential routes are rate limited in Redis: login, register, request-password-reset, reset-password, and verify-email. The bucket is a sliding window keyed by the SHA-256 of the email (or account id) and the client address (`apps/identity-service/src/modules/accounts/infrastructure/redis-auth-rate-limiter.ts`). Only failed sign-ins count, because a successful login withdraws its attempt. A refusal answers `429 rate_limited` with `Retry-After`.
- If Redis cannot be read or written, the route answers `503 rate_limit_unavailable` before any credential is checked. The Redis client has a 500 ms command timeout (`apps/identity-service/src/bootstrap/dependencies.ts`). The limit settings have no defaults.

## Consequences

- Revocation takes effect at once, because every request resolves the session in Postgres. The AWS authorizer does not cache results (`authorizer_result_ttl_in_seconds = 0` in `deploy/aws/main.tf`), so each authenticated call costs one `/auth/me` round trip. [observed]
- A Postgres outage denies every session check, because the authorizer denies on any identity-service answer other than 200 or 401 (`deploy/aws/lambda/authorizer.mjs`). [observed]
- CSRF is enforced in two places only: identity-service on its own routes, and the AWS authorizer on `/api` (`csrfExemptPrefixes` in `deploy/aws/lambda/policy.mjs`). No other service and no nginx gateway checks `X-CSRF-TOKEN`, so in local Compose the protection rests on `SameSite=Lax` and on the signed identity header, which a cross-site page cannot read. [INFERENCE]
- The guest cart cookie is set without `HttpOnly` or `Secure`, so script can read it, and possession of the token is the only check on the cart. [observed]
- Rate limiting fails closed. During a Redis outage the five routes answer 503, while `GET /api/auth/me` keeps working because sessions live in Postgres (runbook). Locally the bucket may be per account rather than per client, and the AWS `TRUST_PROXY_HOPS` value is not yet verified (runbook).
- sales-service reuses the `rate_limit_unavailable` code for prescription photo intake, so a photo is never sent to the metered reader unmetered ([API Guide](../api-guide.md)).

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-AUTH-005 (actor from context, not body), BR-AUTH-008 (trusted context required), BR-USER-009 (sign-in and session lifetime).
