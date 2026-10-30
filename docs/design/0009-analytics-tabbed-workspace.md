# 0009. The analytics workspace reads one tab at a time

- **Status:** Implemented
- **Author:** @nielpattin
- **Date:** 2026-10-30

## Summary

The staff Analytics page becomes a five-tab workspace (**Tổng quan**, **Doanh thu**, **Khách hàng**, **Tồn kho**, **Mục tiêu**), and a tab reads its own data when it is opened. `GET /api/dashboard/analytics` takes a `section` and answers that section's fields only, with a fan-out limited to the services that section needs. `operations-query-service` keeps each of the four sections for 30 seconds in a bounded cache with single-flight, so a refresh or a crowd of managers refreshing costs the other services one fan-out per section per window rather than one per browser; the targets report stays uncached and is read on every open and refresh. The change touches `staff-web`, `operations-query-service` and its tests, and the analytics documents; no schema, event or service boundary changes.

## Motivation

- **One page, one request, all the work.** `apps/staff-web/src/sections/analytics-section.tsx` renders thirteen sections in one scroll: KPI tiles, customers, channels, sites, products, ABC, categories, the prescription split, inventory health, stock value, expiry, dead stock and targets. Every one of them came from the single `GET /api/dashboard/analytics` request of [design 0007](0007-period-analytics-replenishment-and-action-plans.md), which the page sent on open, on every filter change and on every refresh.
- **That one request fans out to eight reads on four services.** `dashboardAnalytics` in `apps/operations-query-service/src/modules/operations-repository.ts` calls `GET /internal/analytics/sales-documents`, `/internal/analytics/paid-invoices`, `/internal/analytics/customer-first-paid`, `/internal/analytics/dispense-costs`, `/internal/analytics/stock-health`, `/pricing/base-prices`, `/sites` and `/internal/analytics/products` on every call. A manager who opened the page to read stock value paid for the customer cohort and the ABC classes as well.
- **Hiding sections in the browser would not lower that load.** The cost is the request, not the rendering. Collapsing four fifths of the page still sends one request that asks four services for all eight answers.
- **Refreshes multiply it.** F5 repeats the whole fan-out; fifty managers watching a month-end therefore generate fifty fan-outs per refresh cycle, and the paid-invoice and stock reads are the expensive ones.
- **The instance count is known and small.** The demo stack runs operations-query as a single task ([design 0006](0006-aws-demo-deployment.md), "Demo sizing": `desired_count = 1`), so a per-process cache is a bounded answer there; the multi-task limit is stated below.

## Goals

- Five tabs, one open at a time, **Tổng quan** by default; the open tab is in `?tab=`, deep links reproduce it, and only the open tab renders and requests.
- One request per section, carrying that section's fields only, over the shared period, site and channel filters; the targets tab keeps its own month and its own route.
- Section-specific fan-out: a section reads only the internal endpoints whose figures it shows.
- A repeated request for the same section, filters and site scope inside 30 seconds answers from the cache and does not repeat the fan-out; concurrent duplicates share one in-flight load.
- The cache is bounded (200 entries, least recently used evicted) and never serves one caller's site scope to another.
- A cache hit or coalesced answer is visible to the caller as `X-Analytics-Cache: hit | miss | coalesced`; an analytical answer's `generatedAt` tells how old its figures are.
- **Mục tiêu** is read from `GET /api/dashboard/sales-targets` on every open and refresh, with no cache and no `X-Analytics-Cache`, so a target just set shows on the next read.

## Non-goals

- A cache shared by instances (Redis or similar), or invalidation on integration events. See Alternatives and Open questions.
- New figures, charts, exports or definitions; the business rules BR-REPORT-008 to 018 are unchanged.
- Changing the sales-targets write path (`PUT /api/sales-targets`) or moving targets into the analytics sections.
- Caching any other dashboard, finance, report or audit route. The cache is opt-in per route and only the analytics route uses it.
- Caching `GET /api/dashboard/sales-targets`. A target can change through `PUT /api/sales-targets` at any moment, and a 30-second cached report would answer the old value after the client refetches, which is exactly the case this page must not have.

## Proposed design

### Frontend (`apps/staff-web`)

`sections/analytics-section.tsx` keeps the page and gains the tab strip; `sections/analytics/` keeps the contract, the period maths, the figures and the target dialog.

- The tab comes from `?tab=overview|revenue|customers|inventory|targets`, through `useListUrlState` (`apps/staff-web/src/hooks/useListUrlState.ts`), the hook the page already uses for its filters. `/analytics` opens `overview`; an unknown value opens `overview` rather than an error.
- **Tổng quan**, **Doanh thu**, **Khách hàng** and **Tồn kho** share the period, site and channel controls; the choice lives in the URL and is kept when the manager changes tab. **Mục tiêu** shows the month picker (`?month=YYYY-MM`) and the shared site filter. The page's URL keys are `?tab=`, `?period=`, `?from=`, `?to=`, `?site=` (`all` or a site id), `?channel=` and `?month=`; only the API parameter is named `siteId`.
- Only the open tab is mounted, so only its query exists: a tab never opened sends no request. The query key carries the section and the filters, so returning to a tab opened earlier in the visit shows its cached figures without a request while they are fresh (30 seconds); after that a revisit reads again. A filter change refetches the open tab and marks the others stale.
- The refresh control refetches the open tab only. Nothing polls, and no tab refetches another.
- After a successful target write the tab invalidates its targets query and reads the report again; because the route is uncached, the new target and revenue show on that read.
- Each tab owns its skeleton and its error alert, so a failing tab leaves the others readable.
- An analytical tab shows its own freshness, not the browser clock: "Cập nhật lúc <generatedAt>" and "Số liệu có thể cũ tối đa 30 giây." above its content. **Mục tiêu** shows no such line, because `GET /api/dashboard/sales-targets` carries no `generatedAt`; it has its own **Làm mới** beside the month picker.

### Contracts

`GET /api/dashboard/analytics` in `apps/operations-query-service/src/modules/operations-routes.ts` (route `router.get("/dashboard/analytics")`, schema `analyticsQuerySchema` in `analytics.ts`):

| Part | Value |
| --- | --- |
| Query | `section` **required**, one of `overview`, `revenue`, `customers`, `inventory`; `from` and `to` (ISO date-time, `from` inclusive, `to` exclusive, at most 366 days); `siteId` optional, inside the caller's sites; `channel` optional, `all` (default), `counter` or `online` |
| Answer | `{ section, currency: "VND", generatedAt, period: { from, to }, previousPeriod: { from, to }, siteId, channel }` plus exactly one of `kpis` + `channels` (overview), `breakdown` (revenue), `customers` (customers), `inventory` (inventory) |
| Errors | a missing or unknown `section` answers `400`; `to` not after `from` or a span over 366 days answers `422` `analytics_range_too_large`; a site outside the caller's sites answers `403` `site_access_denied` |
| Header | `X-Analytics-Cache: hit` or `coalesced` or `miss` on a `200` analytics answer only; an error carries no header, and the targets route carries none at all |

The field shapes are the sub-objects of the existing `DashboardAnalytics` type in `analytics.ts`, unchanged, so the tables and tiles reshape nothing. `GET /api/dashboard/sales-targets` keeps its contract from design 0007 and the [API guide](../api-guide.md#query-projections), stays uncached, and answers no `X-Analytics-Cache`; the four analytical sections carry no target.

### Conditional fan-out

`AnalyticsQuery` carries the `section`, `dashboardAnalytics` in `operations-repository.ts` fans out only the reads that section shows, and `buildAnalyticsSection` in `analytics.ts` builds exactly one tab's fields; the all-in-one `buildDashboardAnalytics` is removed rather than kept beside it. The reads per section:

| Section | Internal reads | Windows |
| --- | --- | --- |
| `overview` | `sales-documents`, `paid-invoices`, `dispense-costs` | the sales window widens to `from = previousPeriod.from`, `to = period.to`, and the two invoice-derived reads use `since = previousPeriod.from`, because the tiles show the previous period |
| `revenue` | `sales-documents`, `paid-invoices`, `/internal/analytics/products`, `/sites` | the period only: `sales-documents` with `from = period.from`, `to = period.to`; `paid-invoices` with `since = period.from` |
| `customers` | `sales-documents`, `paid-invoices`, `/internal/analytics/customer-first-paid` | the period only, as above |
| `inventory` | `/internal/analytics/stock-health`, `/pricing/base-prices?day=YYYY-MM-DD`, `/sites` | `stock-health` with the period; prices for today |

The retail site list (`/sites`) is needed wherever a site name is printed; the classification list is needed wherever a product, category or prescription flag is printed. A failed read still throws `AnalyticsReadError` and fails the section, as before: no partial answer.

### Response cache

New module `apps/operations-query-service/src/modules/analytics-cache.ts`: class `AnalyticsCache`, constructed as `new AnalyticsCache({ ttlMs: 30_000, maxEntries: 200 })`, method `getOrLoad<T>(key, load): Promise<{ value: T; outcome: "hit" | "miss" | "coalesced" }>`. One instance belongs to the operations-query process; a second task keeps its own. Only the four `/dashboard/analytics` sections go through it; `/dashboard/sales-targets` never calls it.

- **Key.** The key is a literal, `|`-joined tuple, so an operator can read one in a log:
  `["dashboard/analytics", section, from, to, siteId ?? "", channel ?? "all", scope].join("|")`
  `scope` is `*` when the caller has no site restriction and otherwise the caller's site ids sorted ascending and joined with `,`; an empty scope is the empty string, which is distinct from `*`. The employee's identity, token and email are never part of a key. The scope is what keeps a Platform Admin's all-sites answer from being served to a site-scoped manager.
- **Hit.** An entry whose `expiresAt` is still ahead is returned and moved to the end of the insertion order, so eviction takes the least recently used entry first.
- **Miss.** The loader runs and its answer is stored with `expiresAt = now + 30 s`. A loader that throws stores nothing and rejects the caller, so an error is never replayed to the next request.
- **Coalesced.** A second request for a key that is already loading joins the same promise, so a burst of identical requests does the fan-out once. When the load settles, the in-flight entry is dropped.
- **Bounded.** More than 200 live entries drops the oldest-inserted, which the hit path keeps equal to the least recently used.

### Why the tabs alone do not reduce server load

A tab strip changes what the browser renders. The load on `operations-query-service` and on the four services behind it is the count and size of requests, and before this change the page sent one request that asked for all eight answers no matter how much of the page the manager read. Hiding a section client-side keeps that request intact.

The reduction comes from three separate things, and the design needs all three:

1. **The section parameter**: a request carries one section's fan-out, so opening stock value no longer reads the customer cohort or the ABC classes.
2. **Lazy mounting**: a tab never opened sends nothing at all, which is the case the tab strip buys.
3. **The cache**: F5, a filter re-applied and fifty managers opening the same tab at month-end all repeat the same request. Without a cache each repetition is a fresh fan-out; with the 30-second cache the other services see at most one fan-out per key per 30 seconds **per instance**, and simultaneous duplicates coalesce onto one. Tabs alone leave that amplification untouched.

The staleness this buys is bounded and visible on the analytical tabs: an answer is at most 30 seconds older than the clock, `generatedAt` says when it was computed, and the tab prints it as "Cập nhật lúc …" beside "Số liệu có thể cũ tối đa 30 giây." A paid invoice may therefore take up to 30 seconds to move an analytical figure. **Mục tiêu** is outside the cache: it reads the targets report on every open and refresh, so a target set through `PUT /api/sales-targets` shows on the next read rather than after a window.

### Single-instance limitation

Each operations-query process keeps its own map. With `N` tasks in front of the load balancer, a cold key is loaded up to `N` times per 30-second window, one per task, and a restart starts empty. There is no cross-instance invalidation, so two tasks may briefly answer the same section with different figures; both are inside the 30-second window and both carry their own `generatedAt`. The demo stack runs one task ([design 0006](0006-aws-demo-deployment.md)), where the cache is exact. The targets report has no such limit, because it is not cached.

### Data model

None. The cache is an in-memory `Map` in the service process holding only the four analytics sections; nothing is persisted, no migration is added, and a restart costs one fan-out per section. The targets report is not stored anywhere.

### Events

None. The cache holds a derived read; integration events, their outbox rows and their consumers are unchanged ([ADR 0003](../adr/0003-transactional-outbox-and-integration-events.md), [design 0001](0001-operations-query-reads-only-events.md)).

### Security and CSRF

- **Who may call.** `sectionRoles.analytics` at the edge and in the service ([ADR 0017](../adr/0017-roles-checked-at-the-edge-and-in-each-service.md)): Pharmacy Manager and Platform Admin, the latter read-only ([ADR 0019](../adr/0019-platform-admin-reads-and-administers.md)). Every other role is refused.
- **Site scope.** The service resolves the caller's sites from the edge identity, and a named site outside them answers `403`. On the analytical sections the scope is part of the cache key, so a cache hit can never widen a caller's scope; the key holds no identity, so a hit is not an authorization shortcut either, because the role and the scope are checked before the cache is consulted. **Mục tiêu** is read from sales-service on every request with the same scope rules and no cache in between.
- **No writes.** Both routes are `GET`, so no CSRF token applies; the only write on the page is `PUT /api/sales-targets`, which keeps its rule.
- **No new secret.** The cache adds no credential or external service.

### Observability

- The `X-Analytics-Cache` value on an analytical section is the observable signal: one `miss` followed by `hit`s in a browser session or a load test shows the cache working, and a run of `coalesced` shows a burst. The targets route has no such header, so its absence there is expected, not a fault.
- Trace spans keep the route and the section; a `miss` trace shows which internal reads the section made, which is the fan-out this design narrows.
- No new metric, dashboard or alert. The route already has a span under the existing collector configuration; a cache hit is a property of an answer, not a health signal.

## Alternatives considered

- **One request, tabs only in the browser (the page as it was, with a tab strip).** Rejected: the fan-out is unchanged, so a tab click, a refresh and fifty managers still cost eight reads on four services.
- **One request per tab that still computes every section and lets the client pick one.** Rejected: the payload shrinks but the fan-out does not, which is the cost this design targets.
- **Five separate routes (`/dashboard/analytics/revenue`, …).** Rejected: the envelope, the filters and the error rules are shared, so an enum on one route keeps one schema and one route-table entry; five routes would duplicate the authorization and the scope handling five times.
- **A shared Redis cache.** Rejected for now: it adds a dependency and a failure mode to a read that tolerates 30 seconds of staleness, and it needs an invalidation protocol to be worth more than the per-instance cache. It is the answer if operations-query scales out; see Open questions.
- **Client-side caching only (a `staleTime` on the query).** Rejected as the mechanism: it helps a tab switch inside one browser, and does nothing for F5, for a new browser, or for the other managers.
- **Caching `GET /api/dashboard/sales-targets` with the same 30-second window.** Rejected: a target is written from the same tab through `PUT /api/sales-targets`, and a cached report would answer the old amount after the client refetches — a wrong figure on the screen that just changed it. The report is cheap next to the analytics fan-out and is read on each open and refresh instead.
- **A longer TTL or one cache entry for the whole report.** Rejected: a longer TTL hides writes for longer than a manager expects, and one entry per filter combination makes the key space unusable and the staleness uneven.
- **Event-driven invalidation (drop the section when a paid invoice arrives).** Rejected: it would make the cache a consumer with a queue and a failure mode for a 30-second read.

## Rollout and migration

- One release of `operations-query-service` and `staff-web` together. `section` is required, so an old `staff-web` against the new service would read `400`; the two web apps and the service ship in the same image set ([design 0006](0006-aws-demo-deployment.md)) and no other client calls the route, so there is no compatibility window and no shim. Deploying the service first is harmless only while the old page is not open.
- No data migration, no backfill, no feature flag. The cache starts empty and fills on the first request.
- **Rollback** is the previous two images; nothing persisted means nothing to undo.
- Updated in the same change: `apps/operations-query-service/src/modules/analytics.test.ts`, `analytics-repository.test.ts`, `analytics-routes.test.ts`, the new `analytics-cache.test.ts`, the staff-web analytics tests, [the spec](../product/staff-analytics.md), [the API guide](../api-guide.md#query-projections) and this design.

## Testing

- **Unit, `analytics.test.ts`:** `buildAnalyticsSection` answers its one field and the shared envelope for each section; `overview` alone computes the previous period; the required-`section` schema cases; each section's figures keep the definitions of design 0007.
- **Cache, `analytics-cache.test.ts`:** a hit inside the TTL; an expired entry reloads; the least recently used entry is evicted at the bound; two concurrent loads of one key produce one loader call and one `coalesced` outcome; a rejected loader is not stored.
- **Repository, `analytics-repository.test.ts`:** each section makes only the reads of its row above with the stated windows; a failed or malformed read still throws `AnalyticsReadError`; the targets read keeps its own reads.
- **Route, `analytics-routes.test.ts`:** a missing and an unknown `section` answer `400`; each section calls only the internal endpoints of its row above; the `overview` windows widen to the previous period while the other sections use the period; two concurrent identical requests make one fan-out; a request from another site scope misses and does not read the first scope's answer; `403` and `422` answers carry no `X-Analytics-Cache`; `GET /api/dashboard/sales-targets` never touches the cache and answers no header, and two reads of it after a `PUT` see the new target.
- **Browser:** `/analytics` sends one `overview` request and no other; opening **Doanh thu** sends one `revenue` request; returning to **Tổng quan** sends none; a filter change sends one request for the open tab; F5 inside 30 seconds answers `hit` and keeps the "Cập nhật lúc" time; a forced failure of one tab leaves the others readable.
- **Load (to run, not yet run):** point the 1,000-user harness of [the runbook](../runbook.md) at one analytics section and count `X-Analytics-Cache` values: the internal analytics reads must not grow with the refresh count, only with the number of distinct keys per 30-second window.

## Open questions

- If operations-query ever runs more than one task outside the demo, is a shared cache worth its dependency, or is per-instance staleness acceptable at 30 seconds? Infrastructure owner.
- Is 30 seconds the right window for every section, or should the inventory section (the most expensive read) keep longer than the KPI tiles? Owner, after a month of traces.

## Related ADRs

- [ADR 0003](../adr/0003-transactional-outbox-and-integration-events.md): the events the read model is built from, unchanged.
- [ADR 0017](../adr/0017-roles-checked-at-the-edge-and-in-each-service.md): the role check the section route keeps.
- [ADR 0019](../adr/0019-platform-admin-reads-and-administers.md): Platform Admin reads every section and writes no target.
