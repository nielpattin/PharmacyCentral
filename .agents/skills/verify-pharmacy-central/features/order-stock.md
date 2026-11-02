# Online order stock and invoice pricing

An online order holds stock from the moment it is placed, the goods leave the shelf when staff hand the order over, and a shopper's invoice is priced by the server. This feature has no browser path of its own; the helper starts the real services and drives them over HTTP and the broker.

## Run

```bash
node .agents/skills/verify-pharmacy-central/scripts/order-stock-proof.mjs [--run <id>]
```

The helper is mode independent and runs the same in dev mode and in container mode. It neither launches nor stops any app, and it needs no browser.

Needs the infra containers healthy (`docker compose ps` shows RabbitMQ and PostgreSQL up: `pnpm run dev:infra` in dev mode, part of `pnpm run aws` in container mode). Starts inventory-service, sales-service and payment-service on free ports, each on a scratch database, with a scratch RabbitMQ vhost. Catalog is a stand-in inside the script, so no AI provider is called. Removes the databases and the vhost, and kills the processes it started, in a `finally`.

## Checks (7)

1. An order for 2 units holds 2 of 3 across two locations, earliest expiry first (`stockHold` is `held`, on hand 3, reserved 2).
2. An order for 2 more units is answered `409 insufficient_stock`, cancelled, and holds nothing.
3. The invoice of a shopper is for `2 x 45000` although the request said a unit price of 1; another shopper gets `404` for that order.
4. A signed SePay webhook confirms the order through RabbitMQ (`Confirmed` and `Paid`, the stock still held).
5. Moving the order to `Completed` takes the held goods off the shelf once (on hand 3 to 1, reserved 0, one `Order` ledger entry of -2).
6. A refund event cancels an order that was not handed over and frees its stock.
7. An order aged past 30 minutes is cancelled by the sweep, its stock is freed, and an invoice for it is `409 order_not_payable`.

Evidence: `.tmp/verify/<run-id>/evidence/order-stock/order-stock-proof.json` and one log per service. The status in the README table is mapped, not yet re-run under this workflow.

## Gotchas

- The sweep runs every minute, so check 7 waits up to about 100 seconds.
- The proof sends the internal-service secret and an `x-actor-id`, which is how the services trust each other; it sends no browser cookie, so it does not exercise CSRF or the gateway.
- Catalog is not started (it embeds with a paid provider on boot). The real price lookup of catalog is therefore not covered here.
