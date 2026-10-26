# 0003. Transactional outbox and integration events

Status: Accepted

Date: 2026-09-10

## Context

Services tell each other about changes they own through integration events, not synchronous calls. The first service
commits of 2026-09-10 (`6ee055d` catalog, `cf6dce1` inventory, `c494340` sales, `3aaa91b` payment) already write an
`outbox_messages` table in each service's own database, relayed to RabbitMQ. The delivery rules were hardened on
2026-10-21 (`b9adbe5`). Its message gives the faults: inventory published with a bare `channel.publish` after the stock
transaction committed, so a crash in between lost the event; sales and payment marked a row published before the broker
confirmed it, and two relays could send the same row. The current rules are in
[architecture.md](../architecture.md#integration-events) and the [runbook](../runbook.md#messaging-operations).

## Decision

- A business transaction writes its change and its event row in the same database transaction. Producers are identity,
  catalog, inventory, sales and payment. Audit entries use the same table (`apps/<service>/src/modules/audit/`).
- The request's W3C `traceparent` is stored on the row by a column default (`currentTraceparent` in
  `shared/infrastructure/trace-context.ts`). The relay publishes under it, so one trace runs from the request to each
  consumer (commit `8ac6caf`).
- Each service's `outbox-publisher.ts` relays unpublished rows to the topic exchange `pharmacy.events`, 500 rows per batch,
  on a publisher-confirm channel. It marks a row published only after the broker confirms it. A transaction-scoped
  advisory lock (`pg_try_advisory_xact_lock`) lets one relay per database publish, which keeps the order. Published rows
  are deleted after seven days.
- Delivery is at least once. Consumers apply events idempotently through inbox or projection keys.
- Consumers bind durable quorum queues named `<owner>.<topic>.v2` with prefetch 1. A failing message is retried five times
  with a growing delay, then rejected to `pharmacy.events.dead` and parked on `<queue>.dead`. A payload that is not a
  well-formed event is parked at once (`sales-service/src/modules/payment-event-consumer.ts`,
  `operations-query-service/src/modules/rabbitmq-event-consumer.ts`).
- Current queues: `catalog.availability.v2`, `sales.payment-events.v2` and `operations-query.events.v2` (binding `#`).

## Consequences

- An event survives a broker outage or a crash after the commit; it is only delayed. The `Outbox stuck` alert fires when the
  oldest unpublished row is older than 120 s for 2 minutes.
- Every consumer must tolerate duplicates.
- Queue arguments cannot change in place, so a change ships under a new name (`.v1` to `.v2`), and the old queue is deleted
  by hand (runbook).
- A dead-lettered message is not retried automatically. Someone must find the cause and republish it (runbook).
- Known deviation: `operations-query-service` is meant to read only through events, but it also calls catalog, inventory
  and sales over HTTP for summary figures (`apps/operations-query-service/src/modules/operations-repository.ts`).
  architecture.md lists this as a deviation to remove.

## Alternatives considered

- Publish directly after the commit: inventory's code before `b9adbe5`. A crash between commit and publish lost the event.
- Mark a row published when `publish()` returns, without a broker confirm: sales and payment before `b9adbe5`.

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-EVT-001 to BR-EVT-004 (outbox, relay, consumers), BR-ORD-006 and BR-ORD-010 (order reaction to payment events), BR-PAY-010 (invoice events), BR-AUDIT-001 (audit source events).
