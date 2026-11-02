# Event delivery between services

A change in one service reaches the others as an event over RabbitMQ: `identity-service`, `catalog-service`, `inventory-service`, `sales-service`, and `payment-service` write the event to their own outbox in the same transaction as the change, an outbox publisher relays it to the exchange `pharmacy.events`, and `sales-service`, `catalog-service`, and `operations-query-service` consume it from their own durable queues. This is how the order becomes paid after a payment, how the storefront learns that a product is out of stock, and how the staff dashboards are fed. This feature needs no browser, no service port, and no AI.

## Sub-features

- `outbox-relay` sends the unpublished outbox rows to the broker in order, marks a row published only after the broker confirmed it, and sends again what the broker refused.
- `relay-reconnect` rebuilds a dropped broker connection and sends what waited meanwhile.
- `relay-single-writer` lets two relays on one database publish each row once, in order.
- `audit-entry` carries who did what from a service's audit recorder, through its relay, into the operations audit log with the actor.
- `consumer-retry-dead-letter` retries a failing message five times, then parks it on `<queue>.dead`. A payload that is not JSON or not a well-formed event is parked at once.
- `consumer-reconnect` re-attaches the consumers after the broker drops them.
- `fail-fast-config` stops a service that starts without `RABBITMQ_URL`.

## How to get to it (user POV)

- There is no screen. A shopper sees the effect: the order reads `Đã xác nhận` after payment (cart-and-checkout.md), and a product leaves the storefront stock flag after its last unit is sold.
- An operator sees the queues in the RabbitMQ Management UI at `http://localhost:15672`. A non-empty `<queue>.dead` queue is an event nobody applied, see `docs/runbook.md`, section Messaging operations.

## Driving it with the browser global

Do not open a browser for this feature. It is driven by one helper, which uses the real publisher and consumer classes from `apps/`, a scratch RabbitMQ vhost, and scratch PostgreSQL databases (one per service it exercises). The helper is mode independent: it runs the same in dev mode and in container mode, and it neither launches nor stops any app.

```bash
node .agents/skills/verify-pharmacy-central/scripts/messaging-proof.mjs [--run <id>]
```

Preconditions:

- `docker compose ps` lists `rabbitmq` and `postgres` healthy. In dev mode that is `pnpm run dev:infra`; in container mode they are part of `pnpm run local:up`. No service has to run, and none is started.
- In dev mode, `.tmp/verify/current` names a run, or pass `--run <id>`. In container mode, pass `--run container-<YYYYMMDD-HHMMSS>` if the run has one. Without either, the helper creates its own run folder.

It runs 15 checks, about 75 seconds, and prints `PASS` or `FAIL` for each:

- **Inventory relay.** Three outbox rows reach the queue in order, and the `eventId` of each event equals the row id. Every row is marked published.
- **Relay reconnect.** All connections of the vhost are closed with `rabbitmqctl close_all_connections`, a row is inserted, and it arrives.
- **Single writer.** A second relay starts on the same database, 40 rows are inserted, and exactly 40 events arrive, with no duplicate and in outbox order.
- **Sales, payment, catalog and identity relays.** The same three-row check for each.
- **Audit entries.** The real audit recorder of identity, catalog and inventory writes one entry each, with one actor. Result: three events reach a queue bound to `*.audit.v1` with that actor on the envelope, and the real operations repository projects them into three `audit_events` rows with the same actor and entity type. A service that stops putting `actorId` on the envelope, or an operations change that drops it, fails here.
- **Consumers.** The sales, catalog, and operations consumers run with stub repositories. A good message is applied, a poison message is attempted five times and then parked, and invalid JSON is parked at once. Result: `<queue>.dead` holds 1 (sales), 2 (catalog), and 3 (operations) messages. The operations consumer binds every routing key, so it sees both poison messages and attempts 10 times in total. Then all connections of the vhost are closed, the consumers attach again within 40 seconds, and the next events are applied.
- **Fail-fast.** Each of `inventory-service`, `sales-service`, `payment-service`, `operations-query-service`, `catalog-service`, and `identity-service` is started with a copy of `.env` that lacks `RABBITMQ_URL`. Result: exit code 1 and the message `Missing required environment variable: RABBITMQ_URL`. The check happens before any side effect, so `catalog-service` does not start its embedding sweep.

Result: exit `0` and `RESULT all 15/15 checks passed`. Evidence: `.tmp/verify/<run-id>/evidence/event-delivery/messaging-proof.json`, with the feature id, the entry point, and one record per check. The helper deletes its vhost and databases itself, also on failure. Check afterwards: `rabbitmqctl list_vhosts` shows only `/`, and no database named `verify_*` exists.

## Gotchas

- The helper never touches a queue, an exchange, or a database of the running stack, because the vhost and the databases are its own. That is why it runs whether the dev stack or the container stack holds the app ports. Do not point it at the default vhost: the relay and the consumers use the exchange and queue names of the real stack.
- It proves the code against the real broker and a real PostgreSQL. It does not prove that the running services are wired to it. For that, read `rabbitmqctl list_consumers` on the default vhost: `sales.payment-events.v2`, `catalog.availability.v2`, and `operations-query.events.v2` each have one consumer while their service runs.
- Queue arguments cannot change on an existing queue (`PRECONDITION_FAILED`), so a change ships as a new queue name. After the move to `.v2`, delete the abandoned `.v1` queues (docs/runbook.md).
- RabbitMQ 4 does not apply `x-delivery-limit` to a requeueing `basic.nack`. The consumers count attempts from `x-acquired-count` and reject on the fifth. Do not replace that count with the queue argument.
- An advisory lock lets one relay per database publish at a time. A relay holds a database transaction while it waits for the broker confirm, so a stuck broker holds one connection of the pool.
- The browser path of the same events (pay an order, see it confirmed) is described in cart-and-checkout.md and is mapped, not yet re-driven under the new rules.
