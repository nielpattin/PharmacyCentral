# 0013. Observability and the System console

Status: Accepted

Date: 2026-10-21

## Context

Services talk over HTTP and RabbitMQ. A request can write an outbox row in one service, be published by its relay, and be processed by consumers in others. Diagnosing a stuck order or a failed webhook needs one trace across those hops. Commit 8ac6caf (2026-10-21) therefore carries trace context in the outbox, and the runbook describes the resulting trace path ([runbook](../runbook.md), Observability).

Commit 92cb484 (2026-10-24) added a System page for what Grafana cannot show: a health verdict and service roster. Its message says traffic, latency, traces, logs, the service map and outbox lag stay in Grafana.

## Decision

1. Each backend service starts an OpenTelemetry Node SDK from `src/telemetry.ts` (for example `apps/sales-service/src/telemetry.ts`). It exports traces, metrics and logs over OTLP, and instruments HTTP, Express, Pino and undici calls. Services fail at startup without `OTEL_EXPORTER_OTLP_ENDPOINT` (commit d816c8a). `search-service` (Go) reports CPU and scheduler latency p99 (commit d63cadc).
2. Trace context crosses HTTP through the undici instrumentation (commit 5a6d187). It crosses RabbitMQ through the outbox: the row stores `currentTraceparent()` on insert, and the publisher runs under `withTraceparent` (`apps/sales-service/src/shared/infrastructure/trace-context.ts`). A null or malformed value publishes without a parent.
3. The collector in `deploy/local/otel/collector.yaml` sends traces to Tempo, metrics to Prometheus and logs to Loki. It polls the RabbitMQ management API for queue depth, and derives span metrics and the service graph. A `filter/foreign_telemetry` processor keeps only resources named `*-service` or with no `service.name`, after a coding agent's spans reached the graph (commit aa9d73d).
4. Grafana is provisioned from files: three datasources, five dashboards in `deploy/local/grafana/dashboards/`, and five alert rules in `deploy/local/grafana/provisioning/alerting/alerts.yaml` (commit ab6fbcf). Business metrics live beside their code, in `outbox-metrics.ts`, `sepay-webhook-metrics.ts`, `chat-step-metrics.ts` and `delivery-metrics.ts` (commit c8d66d8). They cover outbox lag, consumer outcomes, `.dead` queue depth, SePay webhook outcomes, chatbot latency and delivery latency.
5. `apps/ops-console-service` (port 3010) is the read-only backend of the staff-web System page. Only a Platform Admin reaches it, through `/api/system`. It has no database; its `package.json` lists no database driver. It probes each service's `/health/ready` every 15 s (`probe-loop.ts`), and reads Prometheus, the RabbitMQ management API and Typesense (`probes.ts`, `prometheus.ts`). Its route table and service catalog are typed constants, tested against `routes.conf`, the ALB rules and the edge Lambda policy (`route-table.test.ts`, `service-manifest.test.ts`). `requirePlatformAdmin` checks the signed identity context on every path except `/health` (`src/middleware/platform-admin.ts`).

## Consequences

- Grafana remains the tool for deep analysis. The System page omits traffic, latency, traces, logs and outbox lag by design ([runbook](../runbook.md), Grafana bookmarks for the System page).
- A service is kept in telemetry only if its name ends in `-service`. A new service must follow that naming.
- Each service receives one extra readiness request from ops-console every 15 s, on top of Docker healthchecks.
- Metrics are pushed once a minute, so rate panels need a few minutes of traffic. The System page counts instances over a 5-minute window, and its uptime gauge restarts when ops-console restarts (runbook).
- On AWS, Amazon Managed Prometheus accepts only SigV4-signed queries. ops-console does not sign, so the System page's load numbers need a signing proxy in front of `PROMETHEUS_URL`. The Amazon MQ management endpoint was not tested ([runbook](../runbook.md)).
- Local alerts have no notification channel. The runbook marks production notification wiring as a TODO for deploy.
