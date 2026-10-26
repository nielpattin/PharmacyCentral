# 0003. Harden the guest cart cookie and edge identity headers

- **Status:** Draft
- **Author:** TBD (unclaimed)
- **Date:** 2026-10-26

## Summary

The guest cart token is a JavaScript-readable bearer cookie, and the local topology lets a client's own `X-Actor-Id` reach a public cart handler. This RFC makes the guest cookie `HttpOnly` with an environment-driven `Secure`, strips client actor headers at both local gateways and in every service's trusted layer, replaces the anonymous `system` actor with `anonymous`, and removes identity headers from the SePay webhook path. It affects sales-service, payment-service, identity-service, the seven `trusted-request.ts` copies, the authorizer and identity Lambdas, both nginx gateways and `deploy/aws/main.tf`. customer-web needs no code change.

## Motivation

Evidence from code read on 2026-10-26; nothing was run.

**(a) Guest cart cookie.** `apps/sales-service/src/modules/sales-routes.ts:741-743` sets `pharmacy_guest_cart=<token>; SameSite=Lax; Path=/; Max-Age=2592000`, with no `HttpOnly` and no `Secure`. It is written only when the request had no cookie (`sales-routes.ts:71-72`, `:85-86`), so cookies set before this change are never rewritten. `guestToken()` (`:51-52`) also accepts an `X-Guest-Cart-Token` header, which no client sends. Possession is the only check: `findCart` matches the SHA-256 digest (`apps/sales-service/src/modules/sales-repository.ts:855-865`). The digest storage is sound and the token is 24 random bytes. `POST /carts/merge` (`sales-routes.ts:121-131`, `mergeGuestCart` at `sales-repository.ts:154-186`) deletes the guest cart row but leaves the cookie, so the same token recreates an empty cart on the next read. customer-web never reads the cookie: `apps/customer-web/src/customer-api.ts:50-51` reads only `pharmacy_csrf`, and guest calls use `credentials: "include"` (`:59`). Identity's session cookie is `HttpOnly` (`apps/identity-service/src/modules/accounts/presentation/http/account-routes.ts:588-589`). Exposure is identical locally and on AWS: any script on the web origin can read, clear or claim (merge into its own account) a guest cart. [INFERENCE] The cart holds product lines only, with no PII or payment data; confirm against the sales `carts` and `cart_lines` schema.

**(b) Actor headers on public routes.** `apps/sales-service/src/middleware/trusted-request.ts:417-438` overwrites or deletes `x-actor-id` and `x-actor-type` only when a context verifies. On a public request with no context and no valid service secret, the client's values pass through. The same logic is copied in seven services (`apps/{catalog,chatbot,identity,inventory,operations-query,payment,sales}-service/src/middleware/trusted-request.ts`). The local gateways forward them: `deploy/local/gateway/nginx.conf` and `nginx.dev.conf.template` set only `Host`, `Connection` and `X-Forwarded-For`, and `routes.conf` sets no `proxy_set_header`.

The one reachable exploit is sales `/api/carts*`. `sales-service/src/main.ts:115-125` marks `/carts` public (not `/carts/merge`). `actor()` reads `X-Actor-Id` (`sales-routes.ts:45`), and `findCart` ignores the guest token when a customer id is present (`sales-repository.ts:859-861`). So `X-Actor-Id: <victim UUID>` reads, adds lines to, patches and clears the victim's cart. Other public routes were checked and are not exploitable: catalog public reads are GET/HEAD only (`catalog-service/src/main.ts:120-126`) and the audit middleware ignores GET; identity's public `/admin` and `/customers` (`identity-service/src/main.ts:48-51`) authenticate by session cookie and read no actor header (`account-routes.ts:350-380`, `:466-480`); `/internal` requires `x-actor-type=system` but is not public (`:502-512`); the SePay route is registered before the trusted layer (`payment-service/src/main.ts:49-84`, middleware at `:88`).

Anonymous callers become `system`. `deploy/aws/lambda/authorizer.mjs:29` and `deploy/aws/lambda/identity.mjs:20` default `actorType` to `"system"`, and `tests/authorizer.test.mjs:97-153` pins it. Services trust `system`: `readsEveryOrder` (`sales-routes.ts:47-50`), `QUERY_SITE_SCOPE_ACTORS` in `trusted-request.ts`, the audit skip (`catalog-service/src/modules/audit/audit-middleware.ts:87`) and inventory system-only routes (`inventory-routes.ts:351,379`). No public route reaches them today, so this is a hazard for future public routes. On AWS, `deploy/aws/main.tf:1101-1105` overwrites `x-internal-identity-context`, `x-actor-id`, `x-actor-type` and `x-request-id` on `/api/{proxy+}`, and the authorizer never reads client identity headers. ADR 0006 records the same gap ("Locally, a client's own `x-actor-id` ... survives").

**(c) SePay integration.** `deploy/aws/main.tf:1141-1144` overwrites only `path` and `x-request-id`. The handler reads only `x-sepay-*` headers and sits outside the trusted layer, so there is no current exploit. It is a hygiene gap that holds only while the handler never reads identity headers.

**(d) CSRF.** On AWS, `deploy/aws/lambda/authorizer.mjs` checks `X-CSRF-TOKEN` on every non-exempt non-GET (`deploy/aws/lambda/policy.mjs:124-131`), including anonymous guest-cart mutations. Locally nothing checks it in nginx, sales, catalog or payment (ADR 0005). The local exposure is narrow. Services take identity from the `x-internal-identity-context` header, which the web keeps in memory (`customer-api.ts:50-59`) and a cross-site page cannot set. The cookie-only surface is the guest cart. SameSite=Lax withholds it on cross-site unsafe requests, `express.json` accepts only `application/json` so a form post cannot carry a body, and `PATCH`/`DELETE` need a preflight. The residual gap is same-site origins: `customer.` and `staff.pharmacy.localhost` are, in my reading, same-site under ADR 0012 [INFERENCE].

| Exposure | Local (Compose gateway) | AWS |
|---|---|---|
| Guest token readable by script | Yes | Yes |
| Client `X-Actor-Id` on public `/api/carts*` | Exploitable with a victim UUID | Blocked (overwrite and authorizer) |
| Client `X-Actor-Type` on public routes | Passes through; no public handler reads it | Overwritten |
| Anonymous actor type | Absent | `system` (latent hazard) |
| Webhook identity headers | Not overwritten by AWS integration; not read | Not read (hygiene gap) |
| CSRF on guest-cart mutations | Lax and JSON only; same-site open | Blocked by authorizer |

## Goals

- Every `pharmacy_guest_cart` `Set-Cookie` carries `HttpOnly; SameSite=Lax; Path=/`, and `Secure` exactly when `COOKIE_SECURE=true`.
- Neither local gateway forwards client `X-Actor-Id`, `X-Actor-Type` or `X-Actor-Site-Ids` to a service, guarded by a test.
- A request with no verified context and no valid service secret reaches all seven services with no `x-actor-id` or `x-actor-type`.
- AWS anonymous public calls carry `actorType: "anonymous"`, and no service treats it as `system` or `employee`.
- Local `/api` mutations without a matching `X-CSRF-TOKEN` are refused, as on AWS (optional step 7).

## Non-goals

- Replacing the bearer guest token with a server-side session, or binding it to an IP or device.
- Renaming the cookie. A `__Host-` prefix requires `Secure` and cannot work on the plain-HTTP named URLs (ADR 0012).
- Changing the session cookie name or the CSRF double-submit design.
- Extracting one shared trusted-request module (see Alternatives).

## Proposed design

### Contracts

- **Guest cart cookie.** `setGuestCookie` emits `pharmacy_guest_cart=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`, plus `; Secure` only when `cookieSecure` is true. It is emitted on every response that resolves a guest cart, which rewrites pre-existing cookies and slides the 30 days. The `X-Guest-Cart-Token` branch in `guestToken()` is removed, and the `!guestToken(request)` guard goes with it.
- **Merge** (`POST /api/carts/merge`) clears the cookie on success: `pharmacy_guest_cart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`.
- **Identity context.** `actorType` gains `"anonymous"`. No route or path-prefix change, so `routes.conf`, `main.tf` `path_rules` and `policy.mjs` `selectTargetService` are untouched. Update [api-guide.md](../api-guide.md) (Customer catalog and sales, carts) for the cookie.

### Configuration

- New `COOKIE_SECURE`, required, accepts only `true` or `false`. `apps/sales-service/src/main.ts` throws `Missing required environment variable: COOKIE_SECURE` when it is unset (ADR 0010). It has no default and is passed to `createSalesRouter` as `cookieSecure: boolean`.
- Add it to `.env.example` (`false`), to the sales-service environment in `docker-compose.yml` (~line 483, `${COOKIE_SECURE}`), to `deploy/pharmacycentral.env.example`, and to the sales task environment in `deploy/aws/main.tf` (`true`).
- The same flag replaces `NODE_ENV` in identity's cookie writer (`account-routes.ts:579,588`; behaviour unchanged) and in `deploy/aws/lambda/csrf.mjs` `createCsrfCookie`, whose `process.env.NODE_ENV` default becomes a required read at handler creation. The CSRF Lambda environment in `deploy/aws/main.tf` (~line 999) gets `COOKIE_SECURE = "true"`.
- Local keeps `COOKIE_SECURE=false`. Never `true` on plain HTTP, since browser support for `Secure` on `http://*.localhost` is unverified (Open questions).

### customer-web

No code change. It never reads `pharmacy_guest_cart`, so `HttpOnly` leaves `credentials: "include"` working. Check that the merge at `CustomerAuthForm.tsx:52-53` and `OrdersHubPage.tsx:188` still succeeds.

### Local gateways

- In the server block of `deploy/local/gateway/nginx.conf` and `nginx.dev.conf.template`, beside the existing `proxy_set_header` lines:
  `proxy_set_header X-Actor-Id "";`, `proxy_set_header X-Actor-Type "";`, `proxy_set_header X-Actor-Site-Ids "";`. An empty value makes nginx omit the header. `routes.conf` defines no `proxy_set_header`, so the server-level lines apply to its locations; the test below guards that.
- Do not strip `x-internal-identity-context` locally. It is the only identity context there (ADR 0006), and services verify its signature.
- Optional step 7: CSRF parity in nginx. A `map` on `$request_method` and `$uri` (copying `csrfExemptPrefixes`) plus `map "$cookie_pharmacy_csrf:$http_x_csrf_token"` with a PCRE backreference for equality, then `if` returns 403 with identity's CSRF problem body. Unverified; fallback is `auth_request`.

### Services: fail closed on actor headers

In each of the seven `trusted-request.ts` copies, when no context verifies and no service secret is valid, delete `x-actor-id` and `x-actor-type` before `next()`. Internal calls (`internal-service-headers.ts`) keep their secret path.

### Anonymous actor type

- `deploy/aws/lambda/authorizer.mjs:29` and `identity.mjs:20`: `?? "anonymous"`.
- `src/contracts/common.ts` in every service: `z.enum(["anonymous", "customer", "employee", "system"])` (sales lines 23 and 51 today).
- Existing equality checks are unchanged, and `anonymous` matches none of the `employee` or `system` checks.

### SePay webhook

- `apps/payment-service/src/main.ts`: before the webhook route, middleware deletes `x-actor-id`, `x-actor-type`, `x-actor-site-ids` and `x-internal-identity-context`.
- `deploy/aws/main.tf:1141-1144`: add `overwrite:header.x-actor-id`, `overwrite:header.x-actor-type` and `overwrite:header.x-internal-identity-context` with `""`. The service-side deletion stays the guarantee.

### Data model, Events

None. Existing carts keep their tokens and no table changes.

### Security and CSRF

No new secret. One new env var, `COOKIE_SECURE`. The CSRF gap is closed on AWS already; optional step 7 closes it locally. The verifier's replay window (30 s from the authorizer, 5 min from `/auth/context`, ADR 0006) is unchanged.

### Observability

A `warn` log with `request_id` when the trusted layer sees `x-actor-id` on a request with no verified context. Expected to be zero on AWS, and to fall to zero locally once the gateway change is live. Add it to the runbook's observability section.

## Alternatives considered

- **Keep the JS-readable cookie and rely on SameSite.** Rejected: an XSS reads the token, and the fix costs one flag.
- **`__Host-pharmacy_guest_cart`.** Stronger (no `Domain`, `Path=/` enforced), but it needs `Secure`, so it breaks plain-HTTP named URLs locally, and renaming orphans every existing cart.
- **Bind the cart to a signed cookie** (cart id HMAC'd with `INTERNAL_IDENTITY_SECRET`). Adds key use without reducing the theft risk of a bearer token. Rejected.
- **`SameSite=Strict`.** Drops the cookie on top-level navigation from external links, so carts look empty on arrival. Rejected; Lax stays.
- **Gateway-only stripping.** Insufficient: direct service calls (tests, `order-stock-proof.mjs`) bypass nginx, so services must fail closed too.
- **One shared trusted-request package.** Removes the seven-copy drift ADR 0006 notes, but is a larger refactor. Deferred (Open questions).
- **`auth_request` for CSRF.** Adds a hop and an identity-service dependency to every mutation. The map approach stays in the gateway.

## Rollout and migration

1. Services first: contracts accept `anonymous`, the seven trusted-layer copies fail closed, and the webhook middleware lands. Verified requests are unaffected, so this is safe under the current authorizer.
2. Lambdas: authorizer and `identity.mjs` emit `anonymous`. This must follow step 1, because a service with the old enum rejects the new context on non-public routes.
3. Gateways: restart `gateway` or `gateway-dev` only. `nginx.conf` and `routes.conf` are bind-mounted (`docker-compose.yml:309-310`, `:344-345`), so no image rebuild is needed.
4. Cookie: add `COOKIE_SECURE` to every local `.env` before sales-service starts, and document it in the runbook and README. Existing cookies are rewritten on the next guest request, so no migration is needed and carts survive. Rollback reverts the flags; the name is unchanged.
5. Identity and `csrf.mjs`: switch the `Secure` source. No effect while the values match.
6. Cleanup: delete the `X-Guest-Cart-Token` branch, the `NODE_ENV` cookie branches, the `system` default for anonymous, and the test expectations that pin `system` (`authorizer.test.mjs`, `identity.test.mjs:25`).
7. Optional CSRF in nginx, only after confirming every local `/api` mutation sends `X-CSRF-TOKEN`. `tools/k6/lib/session.js:107-111` does; `tools/chaos/lib/gateway.mjs` and `tools/dev-import-samples.mjs` reference it and need checking.

Compatibility: `.omp/skills/verify-pharmacy-central/scripts/order-stock-proof.mjs` calls services directly with the internal secret and is unaffected by gateway stripping. No repository client sends `X-Guest-Cart-Token`. Rollback runs in reverse order; step 2 can be rolled back only with step 1 already live.

## Testing

- **sales-service** (`sales-routes.test.ts`, Vitest): guest responses set `HttpOnly` and `SameSite=Lax`; `Secure` appears iff `cookieSecure`; an existing cookie is re-issued; merge clears it; `X-Guest-Cart-Token` is ignored.
- **trusted-request** (each copy, following `apps/identity-service/src/middleware/trusted-request.test.ts:259` and `:524`): a public request with `x-actor-id` and `x-actor-type` but no context reaches the handler with both absent; with a valid service secret they are kept; with a valid context they are overwritten.
- **contracts** (each `contracts.test.ts`): `anonymous` is accepted.
- **Lambda** (`deploy/aws/lambda`, `npm test`): authorizer and identity tests expect `anonymous`. New `tests/gateway-config.test.mjs` (`node:test`) reads `nginx.conf` and `nginx.dev.conf.template` for the three `proxy_set_header ... ""` lines, asserts `routes.conf` has no `proxy_set_header`, and asserts `x-internal-identity-context` is not stripped. It follows the file-reading pattern of `apps/ops-console-service/src/modules/system/route-table.test.ts`.
- **payment-service**: the webhook test asserts identity headers are removed before the handler runs.
- **Smoke** (new `tools/edge-identity-smoke.mjs` against `API_BASE_URL`): `GET /api/carts` with a random `X-Actor-Id` and no cookie returns 200 with `Set-Cookie: pharmacy_guest_cart=` and `HttpOnly`; `POST /api/carts/merge` with no context returns 401 `trusted_request_required`; `Secure` is present iff `COOKIE_SECURE=true`. Before the change the first call sets no cookie, which reproduces the bug.
- **Verification** (main agent): `pnpm run stack:up`, `docker compose ps` showing all services healthy, then the smoke script. In a browser, confirm the guest cart survives reload and sign-in merge using an isolated per-user profile (AGENTS, Browser testing).

## Open questions

- Does API Gateway HTTP API clear a header when `overwrite:header.x-actor-id` is `""`? Infra owner, by `terraform plan` and a call on a dev stage. Service-side deletion covers the answer either way.
- Where is customer-web served on AWS? `deploy/aws/main.tf` defines no CloudFront or web origin, and `API_BASE_URL` is `execute-api` (`deploy/pharmacycentral.env.example:16`). If web and API are cross-site, every Lax cookie (session, CSRF, guest) is withheld from subresource calls. Deployment owner.
- Do Chromium, Firefox and Safari keep `Secure` cookies on `http://customer.pharmacy.localhost` and `http://localhost:8080`, and are `customer.` and `staff.` same-site? Browser tool, per profile. ADR 0012 notes Safari may not resolve `*.localhost`.
- Does the gateway nginx image accept a PCRE backreference in a `map` pattern (step 7)? `nginx -t` in the container.
- Do any public responses expose customer account UUIDs? This sets the practical severity of the cart IDOR, not whether it exists. Review sales, catalog and search public responses.
- Keep the bearer guest token, or redesign it? Product and security owner.
- One shared trusted-request module versus seven copies (ADR 0006 drift)? Architecture owner.

## Related ADRs

- [0005](../adr/0005-opaque-sessions-and-csrf.md): this RFC would amend its guest cart and local CSRF consequences.
- [0006](../adr/0006-edge-identity-context.md): would amend the anonymous context and local header behaviour.
- [0007](../adr/0007-gateway-path-routing-and-two-topologies.md): gateway changes stay in server blocks and `routes.conf` is untouched.
- [0010](../adr/0010-fail-fast-environment-configuration.md): `COOKIE_SECURE` has no default.
- [0012](../adr/0012-local-development-modes-and-named-urls.md): plain-HTTP named URLs constrain `Secure`.
- Business rules: BR-AUTH-005 and BR-AUTH-008 in [business-rules.md](../business-rules.md). Operations: [runbook.md](../runbook.md#edge-routing-and-security). Contract: [api-guide.md](../api-guide.md).
