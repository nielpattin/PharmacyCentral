# System page

- **Status:** Current
- **App and route:** staff-web, `/system`, tabs in `?tab=` with the English values `Services`, `Messaging`, `API routes`, `Dashboards`. Backend: `apps/ops-console-service` (port 3010, no database), reached at `/api/system*`.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code or doc fact read on 2026-10-26. `[standard]` a decision from industry practice (see Decisions). `[owner]` the owner reviewed and accepted this spec on 2026-10-26. Gap IDs `G1`... are listed under Gaps. See [README](README.md).

## Purpose

- `[observed]` One place for a Platform Admin to see whether each service is up and within limits, whether messages, the outbox and the search index are moving, which service each API path goes to and who may call it, and where to look deeper. The recorded reason: the page was added "for what Grafana cannot show: a health verdict and service roster" ([ADR 0013](../adr/0013-observability-and-system-console.md), Context). Trends, traces, logs, the service map and alert rules stay in Grafana.
- `[standard]` The page follows the Google SRE four golden signals (latency, traffic, errors, saturation) and the RED and USE methods. It shows summary values, not trends, and reads missing data as Unknown, never as healthy (Decisions 3 and 16).

## Users and entry points

- `[observed]` Platform Admin only. The sidebar item **System** (`Hệ thống`) sits in the Governance group; `sectionRoles.system` is `["Platform Admin"]` in `apps/staff-web/src/permissions/section-access.ts`. Another user who opens `/system` is redirected to the first section they can see.
- `[observed]` Three checks: the edge policy (`/api/system` is in `platformAdminPaths`, `deploy/aws/lambda/policy.mjs`); the service (`requirePlatformAdmin`: a verified identity context with `actorType` `employee` and role `Platform Admin`, else 401 `trusted_request_required` or 403 `platform_admin_required`; `/health/*` stays open); and the menu.
- `[standard]` The page is not site-scoped. Platform Admin sees all data ([BR-AUTH-003](../business-rules.md)). It has no approval or write action (Decision 19).

## User stories and acceptance criteria

### US1. As a Platform Admin, I see at a glance whether the platform is healthy, so that I know whether to look closer

- Source: `[observed]` 2026-10-26; the Unknown rule is `[standard]`.
- Accepted when:
  - With every probed service ready, live and within thresholds, the status line reads "Tất cả dịch vụ hoạt động bình thường." (smoke run).
  - With one service not ready, the status line reads "1 dịch vụ ngừng hoạt động" (smoke run).
  - With Prometheus stopped, the status line never reads "Tất cả dịch vụ hoạt động bình thường."; it reads "Thiếu số liệu, chưa đánh giá đủ tình trạng." (smoke run) (gap G1).
  - With an empty service list, the status line reads "Không xác định được tình trạng dịch vụ." (`health.test.ts`) (gap G1).
  - A value the overview did not return shows "Chưa xác định" in its cell, never "-" and never a healthy tone (`service-table-rows.test.ts`) (gap G1).
  - The verdict thresholds in Contents hold at their boundaries (`health.test.ts`).
  - The overview refreshes every 15 seconds on the Services and Messaging tabs; the "Cập nhật lúc" clock changes without a reload, and "Làm mới" refetches the overview and the summary at once (smoke run) (gaps G9, G12).

### US2. As a Platform Admin, I read the golden signals and the key counts per service without opening Grafana

- Source: `[standard]` (Decisions 16 and 20; D14).
- Accepted when:
  - The Services tab opens with four KPI tiles: services "Ngừng", services "Suy giảm", "Hàng đợi cần chú ý" and the largest "Độ trễ outbox" in seconds (smoke run) (gap G20).
  - Each service row shows traffic (req/s), 5xx share, p95 latency, CPU (m), memory (MiB), event-loop lag (p99, ms) and, for services with a database, DB pool used/max (`service-table-rows.test.ts`) (gaps G3, G4).
  - A service with no requests in the window shows "0 req/s" and "Không có yêu cầu" for its 5xx share, not "Chưa xác định".
  - The State cell shows the same tone as the row's dot and reasons (`service-table-rows.test.ts`) (gap G2).

### US3. As a Platform Admin, I open one service to see why it is not healthy and what it calls

- Source: `[observed]` 2026-10-26.
- Accepted when:
  - Selecting the service name opens a sheet titled with it, described "Chi tiết dịch vụ" (smoke run).
  - Each reason the verdict is not healthy is one badge (`REASON_LABEL`); a healthy service shows none. The outbox reason shows its age in seconds (gap G5).
  - The Overview tab ("Tổng quan") shows the description, Database, Port, "Gọi tới", "Được gọi bởi", and the events published and consumed. Selecting a name switches the sheet to that service (`catalog-state.test.ts`, `service-manifest.test.ts`).
  - The Resources tab ("Tài nguyên") charts CPU (m), Memory (MiB) and "Trễ event loop (p99, ms)" for the window in its own picker (15 phút, 1 giờ, 6 giờ, 24 giờ) (gap G11).
  - "Service Overview", "Traces" and "Logs" open Grafana in a new tab with the service filled in (`grafana-links.test.ts`).

### US4. As a Platform Admin, I see messages, outbox and search data in separate rows, so that I can tell which one is behind

- Source: `[observed]` for the queue and search rows; the outbox row is `[standard]`.
- Accepted when:
  - The Messaging tab ("Hàng đợi và tìm kiếm") shows three cards, one per row: "Hàng đợi", "Độ trễ outbox" (one row per service, in seconds, amber above 60 s, red above 300 s) (gap G5), and "Chỉ mục tìm kiếm".
  - Queue rows show "Sẵn sàng", "Chưa xác nhận", "Bên nhận" and "Trạng thái". A non-`.dead` queue with no consumers shows "Không có bên nhận" in amber; a `.dead` queue holding messages shows "Hàng chết" in red; an empty `.dead` queue shows "Bình thường". Queues needing attention sort first, and the header reads "N trong M hàng đợi cần chú ý" or "M hàng đợi, đều bình thường" (`queue-rows.test.ts`).
  - Only queues named `<owner>.<topic>.v<n>` and their `.dead` queues are listed; the count of other queues reads "N hàng đợi khác đã ẩn" (gap G6).
  - Every existing Typesense collection is listed with "N tài liệu" (Decision 10).

### US5. As a Platform Admin, I read which service and which roles may call each API path

- Source: `[observed]` 2026-10-26.
- Accepted when:
  - The API routes tab ("Đường dẫn API") lists each gateway path with its service, access ("Công khai", "Đã đăng nhập", role names, "Chỉ Quản trị nền tảng") and note.
  - "Lọc đường dẫn" matches path, method, service, access and note, ignoring case; no match shows "Không có đường dẫn nào khớp bộ lọc." (`route-rows.test.ts`).
  - The table has no edit control; the `/api/system*` row reads "Chỉ Quản trị nền tảng" (`route-table.test.ts`), and [BR-AUTH-002](../business-rules.md) lists `/api/system` as Platform Admin only (document check).

### US6. As a Platform Admin, I open Grafana for the signals this page does not show, and only project telemetry reaches it

- Source: `[observed]` for the links; the telemetry rule is `[standard]`.
- Accepted when:
  - The Dashboards tab ("Bảng điều khiển Grafana") lists eight links, in this order: "Start here", "RED per service", "Latency heatmap", "Service map", "Trace search", "Log search", "Async messaging", "Outbox and queues". Each opens in a new tab (`grafana-links.test.ts`).
  - The collector keeps spans, logs and metrics only from resources named `*-service` and from RabbitMQ metrics; unnamed spans and logs are dropped (collector config check) (gap G19).

### US7. As anyone who is not a Platform Admin, I cannot read System data; as a Platform Admin whose session ends, I am told so

- Source: `[observed]` for access; `[standard]` for the session rule (D6).
- Accepted when:
  - The System item is absent from the sidebar for every role without Platform Admin (`canAccessSection`).
  - `GET /api/system/overview` answers 403 `platform_admin_required` for a customer, a Pharmacy Manager and a system actor, and 401 `trusted_request_required` without a trusted context (`system-routes.test.ts`, "access").
  - A 401 on any System request shows a Vietnamese notice, sends the user to sign-in, and returns them to the same tab afterwards (smoke run).
  - A failed section shows a Vietnamese message from a fixed mapping, never the raw English error (unit test on the mapping) (gap G18).

## Contents and behavior

`[observed]` unless tagged `[standard]`. Tagged items are the target and carry a gap.

**Header (every tab).** The description "Tình trạng dịch vụ, hàng đợi và chỉ mục tìm kiếm. Tổng quan tự làm mới mỗi 15 giây.", the status line (dot and text), "Cập nhật lúc hh:mm:ss" (24-hour clock), and `[standard]` a "Làm mới" button beside the automatic refresh. The window picker "Khoảng thời gian" (15 phút, 1 giờ, 6 giờ, 24 giờ) shows on Services only and sets the uptime strips.

**Services tab ("Dịch vụ").** `[standard]` Four KPI tiles, then one table. One row per probed service: `identity-service`, `catalog-service`, `search-service`, `inventory-service`, `sales-service`, `payment-service`, `chatbot-service`, `operations-query-service` (`probed-services.ts`). Gateway and ops-console are not probed (Decision 17). Columns:
- Service: colour dot (verdict tone), name (a button that opens the sheet), version, instances.
- State: "Sẵn sàng" (ready and live), "Live lỗi" (amber), "Suy giảm" (amber, degraded by a metric), "Ngừng" (red, not ready).
- `[standard]` Traffic (req/s), 5xx share, p95, CPU (m), Memory (MiB), Event loop lag (p99, ms), DB pool used/max.
- Hoạt động 24 giờ: an uptime strip for the chosen window, and the percentage for the last 24 hours (always 24 h).

**Verdict (`health.ts`).** Readiness failing is down (danger). Liveness failing is a warning. A metric past its warning band degrades the service; a danger band raises its tone to danger. Bands, inclusive as the tests state:

| Signal | Warning | Danger |
| --- | --- | --- |
| 5xx share (5-minute window) | above 1% | above 5% |
| p95 latency | above 1 s | above 2 s |
| DB pool used / max | 80% or more | 95% or more |
| Oldest unpublished outbox row | above 60 s | above 300 s |

Uptime strip tones (`uptime-tracker.ts`): at least 99.9% ok; at least 95% warning; below that danger; no sample neutral.

**Service sheet.** Opens from a row (US3). Its Overview reads the static `service-manifest.ts`, not live traffic. Its Resources tab charts `pharmacy_process_*` series. Its picker starts at the page window and changes only the sheet (Decision 11).

**Messaging tab.** Three rows: queues, outbox lag, search index (US4). Queue data is RabbitMQ `GET /api/queues`, filtered as in Decision 9. Only ready and unacknowledged counts and consumers; queue age stays in Grafana.

**API routes tab.** The gateway table from `route-table.ts` through `GET /api/system/routes`, kept for 10 minutes. It does not depend on the overview and does not poll (G9).

**Dashboards tab.** Eight links built from `GRAFANA_PUBLIC_URL`. Grafana has its own sign-in; the page passes no credentials.

**Data sources.** Each section is fetched and fails alone.

| Section | Source | Timeout |
| --- | --- | --- |
| Services | `/health/ready` and `/health/live` of each service, from the 15-second probe loop (`[standard]`, G8) | 2 s |
| Load (verdict, golden signals, pool, outbox age), version, instances, uptime 24 h | Prometheus instant queries | 10 s |
| Queues | RabbitMQ management `GET /api/queues`, basic auth | 2 s |
| Search index | Typesense `GET /collections`, API key | 2 s |

The Prometheus series are listed in `prometheus.ts` and `promql.ts`; they are not repeated here.

## States

- Loading: "Đang tải tổng quan hệ thống..." until the first overview answer on Services, Messaging and Dashboards. API routes has its own loading state.
- Overview refused: "Cần quyền Quản trị nền tảng." for 403. For 401 the session ends (US7). Other failures: "Không tải được tổng quan hệ thống." The tables do not show.
- Section unavailable: an "Không khả dụng" badge and a Vietnamese message (G18). Services shows the alert in its card; Queues and Search index show it in theirs.
- Load or summary unavailable: metric cells, version, instance and uptime facts read "Chưa xác định"; the status line reads "Thiếu số liệu, chưa đánh giá đủ tình trạng." (`[standard]`, G1). The table stays.
- Services list unavailable: the status line reads "Không xác định được tình trạng dịch vụ."
- Empty: "Không có dịch vụ nào được báo cáo.", "Chưa có hàng đợi nào.", "Chưa có collection nào.", "Không có đường dẫn nào khớp bộ lọc."
- Sheet: "Dịch vụ này không có trong danh sách tình trạng hiện tại."; "Không tải được danh mục dịch vụ."; "Dịch vụ này không có trong danh mục."; "Không tải được số liệu."

## Out of scope

- `[observed]` Traffic and latency trends, the latency heatmap, traces, logs, the service graph and outbox publish lag over time: Grafana ([ADR 0013](../adr/0013-observability-and-system-console.md)). The page shows current values (Decision 16).
- `[standard]` Any action: dead-letter replay, reindex, restart, alert acknowledgement (Decision 19).
- `[observed]` Alert rules and their state (Grafana Alerting, [runbook](../runbook.md#alert-runbooks)), and history: values are current or cover the chosen window.
- `[standard]` Probing the gateway and ops-console themselves (Decision 17).

## Rules and designs

- Business rules: [BR-AUTH-001](../business-rules.md) (Platform Admin), [BR-AUTH-002](../business-rules.md) (route matrix), [BR-AUTH-003](../business-rules.md) (all sites), [BR-AUTH-008](../business-rules.md) (trusted context), [BR-EVT-002](../business-rules.md) (outbox relay), [BR-EVT-003](../business-rules.md) and [BR-EVT-004](../business-rules.md) (what a `.dead` queue means).
- [ADR 0013](../adr/0013-observability-and-system-console.md): the System console and what stays in Grafana; its Consequences are amended by this spec (G16). [ADR 0002](../adr/0002-service-owned-databases.md): ops-console owns no database. [ADR 0007](../adr/0007-gateway-path-routing-and-two-topologies.md): `/api/system` routes to ops-console.
- [Runbook, System page](../runbook.md#system-page-ops-console-service), [Grafana bookmarks](../runbook.md#grafana-bookmarks-for-the-system-page), [Messaging operations](../runbook.md#messaging-operations) (queue names and `.dead`), and [API guide, System overview](../api-guide.md#system-overview).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Why four tabs, why do queues and the search index share "Messaging", why is Dashboards a tab? | `[standard]` Keep four tabs; each answers one operator question: Services (is each service up and within limits?), Messaging (is data moving: queues, outbox, search index, one row each), API routes (who may call what), Dashboards (where to look deeper). | Operations consoles group by the question the operator asks and keep the drill-down links on the same page. Separate rows for messages, outbox lag and search index follow the project's observability decision. |
| 2 | Verdict and State disagree: a red "Live lỗi" with an amber dot, and a green "Sẵn sàng" with an amber dot. | One tone per service drives the dot, the State cell and the reason badges. Not ready: "Ngừng", red. Liveness failing: "Live lỗi", amber. Degraded by a metric: "Suy giảm", amber. A danger-band metric: red. | `[standard]` A status has one meaning. Red means not answering or a danger-band signal; amber means answering with a problem. |
| 3 | Missing data reads as healthy: Prometheus down, or an empty service list. | Missing data is Unknown. The status line says healthy only when every probe and every verdict metric answered. An empty service list is Unknown. A missing cell reads "Chưa xác định", not "-". | `[standard]` D14 and SRE monitoring practice: the absence of a signal is not a healthy signal. A Prometheus outage is itself something to see. |
| 4 | Outbox and queue lag: should the page show a number? | Yes for outbox: a row per service with the oldest unpublished age in seconds. For queues: ready and unacknowledged counts and consumers. Queue age over time stays in Grafana (Business Health). | `[standard]` D14: lag as values, not only badges. Depth and consumer count are the usual RabbitMQ health signals; trends are Grafana's job ([ADR 0013](../adr/0013-observability-and-system-console.md)). |
| 5 | Probe path: `/healthz` or `/health/ready`? | Every probed service answers `/health/ready` and `/health/live`, search-service included (G7). | `[standard]` One readiness endpoint per service (D14). ADR 0013 decision 5 and the probe loop already say `/health/ready`; search-service is the outlier. |
| 6 | Probe rate: each overview request probes every service, and the page refetches on every tab. | The probe loop checks readiness and liveness of each service every 15 s and stores each result with its time. The overview returns stored results and never probes on request. A result older than 30 s is Unknown. | `[standard]` Monitoring load must not grow with the number of viewers. This replaces "one extra readiness request" in ADR 0013 (G16). |
| 7 | Summary step: "15 s for 15 minutes" or "at least 60 s"? | At least 60 s, at most 60 points; a 15-minute window has 15 points. The API guide is corrected to say so (G10). | Metrics are pushed once a minute (ADR 0013 Consequences), so a finer step only repeats values. The range charts already floor the step at 60 s. |
| 8 | Add `/api/system` to the route matrix in BR-AUTH-002? | Yes, as Platform Admin only, next to `/api/admin` and `/api/audit`. | `deploy/aws/lambda/policy.mjs` already enforces it. A rule missing from the matrix is an unrecorded rule (`[standard]` least privilege, D1 and D2). |
| 9 | Queue scope: every queue of every vhost? | Only queues named `<owner>.<topic>.v<n>` and their `<queue>.dead` are listed. Other queues are counted as "N hàng đợi khác đã ẩn". | `[standard]` Keeps the list about the project's events, keeps an abandoned `.v1` queue visible (it has no consumers, so it warns), and fails visibly, not silently. |
| 10 | Retired collections: hide them? | No. Every existing collection is listed. A retired collection is deleted in the cutover step the runbook gives (`catalog_products_v2` once `catalog_products_v3` answers). | Clean cutover: nothing obsolete is kept as a shim, and a hidden collection still uses storage. |
| 11 | Sheet window: its picker does not change the page's, and it resets on the next open. | Keep. The sheet opens with the page window; its own picker changes only the sheet charts; reopening starts from the page window. | `[standard]` A detail view must not move the strips the operator is comparing. |
| 12 | Percentile label: "Event loop lag" or p99? | "Trễ event loop (p99)" in the table and the chart. For search-service the value is goroutine scheduling latency p99, and its tooltip says so. | `telemetry.ts` in sales-service and ops-console exports the p99 per collection; the label must name the metric. |
| 13 | Manual refresh: fix the runbook or add a control? | Add a "Làm mới" button beside the 15-second refresh, using the shared `RefreshButton` in `components/forms.tsx`. The runbook stays as written. | D14: a manual refresh next to the auto refresh. The runbook already describes it. |
| 14 | Unused strings in `i18n/governance.ts`. | Remove them: "Error rate", "Latency p95", "Saturation", "Error ratio", "Unpublished", "No outbox backlog reported.", and the description "Live health and golden signals for each service. Rows over the error or pool thresholds are highlighted." (G13) | Dead keys describe an older table and mislead translators. Clean cutover. |
| 15 | Should `docs/user-guide.md` gain a System section? | Yes: a `## System` section after `## AI integrations`, for Platform Admin, covering the four tabs, the status words and the refresh control (G15). | `[standard]` Each staff page has a guide section. The runbook is an operator document and does not serve the Platform Admin user. |
| 16 | New: are the golden signals shown as values? | Yes. Each service row shows req/s, 5xx share, p95, CPU, memory, event-loop p99 and DB pool. KPI tiles summarise the Services tab. Trends and the heatmap stay in Grafana. | `[standard]` D14: Google SRE four golden signals and the RED and USE methods. A value says how bad at a glance; a badge does not. ADR 0013 is amended (G16). |
| 17 | New: are the gateway and ops-console probed? | No. The page probes the eight services. The gateway is local only ([architecture](../architecture.md)); AWS checks targets through the ALB. ops-console's own `/health/ready` is read by the orchestrator and the ALB. | `[standard]` ops-console cannot report its own outage, and the edge and orchestrator already report theirs. |
| 18 | New: which telemetry reaches the Service map and the trace and log links? | Only resources named `*-service` and RabbitMQ metrics. Spans and logs with no `service.name` are dropped. | Project decision: telemetry excludes spans from coding agents and other unrelated sources. Amends ADR 0013 decision 3 (G19). |
| 19 | New: which actions may this page offer? | None. Dead-letter replay and reindex stay runbook procedures. A future action needs a second person to confirm it. | `[standard]` D1, maker-checker: the person who acts does not approve the action. |
| 20 | New: what happens on a 401? | The session ends visibly: Vietnamese notice, sign-in, return to the page. | D6, the session rule for every page. |
| 21 | Who may see System health? | Platform Admin only; no other role. | `[standard]` Least privilege (D2) and [BR-AUTH-001](../business-rules.md). Owner may change. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | Missing data is "Chưa xác định"; the status line never reads healthy when load or the service list is missing (Decision 3). | With load unavailable the verdict uses probes only, so the line can read "Tất cả dịch vụ hoạt động bình thường."; an empty list is healthy; missing cells show "-". | `apps/staff-web/src/sections/system/health.ts` (`evaluateOverallHealth`, `overallStatus`); `system-section.tsx`; `format.ts` (`DASH`). |
| G2 | The State cell follows the verdict tone (Decision 2). | Red for any probe failure, including liveness; a metric-degraded service reads green "Sẵn sàng"; no "Suy giảm" label. | `apps/staff-web/src/sections/system/service-table.tsx` (`ServiceRow`); `service-detail-sheet.tsx` header. |
| G3 | Golden signals as values per service, and DB pool (Decision 16). | The table shows CPU, memory, event-loop lag and uptime. 5xx share, p95 and DB pool appear only in the verdict. | `service-table.tsx`; `service-table-rows.ts`. |
| G4 | Traffic (req/s) per service in the overview (Decision 16). | `probeLoad` computes requests per second for the error ratio, but `ServiceLoad` does not return it; `docs/api-guide.md` `load[]` does not list it. | `apps/ops-console-service/src/modules/system/prometheus.ts` (`probeLoad`, `ServiceLoad`); `docs/api-guide.md` (System overview). |
| G5 | Outbox lag as a value row per service, amber above 60 s, red above 300 s (Decision 4). | The value is returned (`outboxOldestSeconds`) but shown only as a reason badge in the sheet. There is no outbox row. | `service-detail-sheet.tsx` (`REASON_LABEL`); `messaging-tab.tsx`. |
| G6 | Queues limited to `<owner>.<topic>.v<n>` and `.dead`, others counted as hidden (Decision 9). | Every queue from `GET /api/queues`, all vhosts, no name filter; no hidden count. | `apps/ops-console-service/src/modules/system/probes.ts` (`probeQueues`); `apps/staff-web/src/sections/system/queues-card.tsx`. |
| G7 | `/health/ready` and `/health/live` on every probed service (Decision 5). | `probed-services.ts` probes search-service on `/healthz`, and `search-service` serves only `GET /healthz`, with no `/health/*` routes. | `apps/ops-console-service/src/modules/system/probed-services.ts`; `apps/search-service/internal/handler/handler.go`. |
| G8 | Probes come from the 15-second probe loop; a request reads stored results (Decision 6). | Each `/api/system/overview` request probes `/health/live` and `/health/ready` of every service. ADR 0013 says one readiness request per 15 s. | `probes.ts` (`probeServices`); `system-routes.ts` (`/system/overview`); `probe-loop.ts`; [ADR 0013](../adr/0013-observability-and-system-console.md) Consequences. |
| G9 | The overview is polled on Services and Messaging only (US1). | The overview query lives at section level and refetches every 15 s on every tab, Dashboards and API routes included. | `apps/staff-web/src/sections/system-section.tsx`. |
| G10 | Summary step at least 60 s, at most 60 points (Decision 7). | `pointStepSeconds` floors the step at 15 s. [API guide](../api-guide.md) System overview says both "15 s for 15 minutes" and "at least 60 s". | `apps/ops-console-service/src/modules/system/prometheus.ts` (`pointStepSeconds`); `docs/api-guide.md` (System overview, lines 301-303). |
| G11 | "Trễ event loop (p99)" label (Decision 12). | Label "Event loop lag"; the exported value is p99 (`pharmacy.process.event_loop_lag` in sales-service and ops-console telemetry). | `service-table.tsx` (header); `service-detail-sheet.tsx` (`CHARTS`). |
| G12 | A "Làm mới" button beside the auto refresh (Decision 13). | Only the 15-second refetch exists. The runbook says the header has a refresh control. | `apps/staff-web/src/sections/system-section.tsx`. The runbook is right. |
| G13 | No unused System copy (Decision 14). | Keys "Error rate", "Latency p95", "Saturation", "Error ratio", "Unpublished", "No outbox backlog reported." and the "Live health and golden signals…" description are unused. | `apps/staff-web/src/i18n/governance.ts`. |
| G15 | A System section in the user guide (Decision 15). | None. The page is documented only in the runbook. | `docs/user-guide.md`. |
| G16 | ADR 0013 Consequences and the runbook bookmarks match Decisions 6 and 16. | ADR 0013 says the page omits traffic, latency and outbox lag, and that each service gets one readiness request per 15 s. The runbook lists requests, 5xx, p95 and DB pool as Grafana-only. | `docs/adr/0013-observability-and-system-console.md` (Consequences); `docs/runbook.md` (Grafana bookmarks table, lines 540-548). Both docs need amending. |
| G18 | Failed sections show a Vietnamese message (D7). | Section failures show fixed Vietnamese messages: `settle` replaces the English cause. The overview-level failure shows the raw English `error.message` from `request()`, not a Vietnamese message. | `apps/ops-console-service/src/modules/system/probes.ts` (`settle`); `apps/ops-console-service/src/modules/system/system-routes.ts`; `apps/staff-web/src/sections/system-section.tsx` (`errorMessage`) |
| G19 | Only `*-service` resources and RabbitMQ metrics reach the Service map and traces (Decision 18). | `filter/foreign_telemetry` drops only named resources that do not end in `-service`; resources with no `service.name` pass every pipeline. ADR 0013 decision 3 says the same. | `deploy/local/otel/collector.yaml` (lines 34-46); [ADR 0013](../adr/0013-observability-and-system-console.md) decision 3. |
| G20 | KPI tiles and grouped panels on Services and Messaging (Contents). | A status pill, one table, and cards. No KPI tiles and no grouped metric panels. | `apps/staff-web/src/sections/system/services-tab.tsx`; `messaging-tab.tsx`. |
