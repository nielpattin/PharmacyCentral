// RabbitMQ stopped for 60 s under checkout load. The outbox decouples the writes: orders keep being accepted and their
// rows wait in each service's outbox. Once the broker is back, every event written in the window is published, the
// operations read model and the catalog apply each one exactly once, and sales marks every paid order.
import * as q from "../lib/queries.mjs";
import { ACCOUNTS } from "../lib/gateway.mjs";
import { placeOrder, sellableLine } from "../lib/shop.mjs";

const VUS = 10;
const OUTAGE_MS = 60_000;
const SAMPLE_MS = 10_000;
// Prometheus receives k6 metrics every few seconds; wait at least one flush before reading them.
const METRICS_FLUSH_MS = 15_000;
const CONSUMER_QUEUES = ["catalog.availability.v2", "operations-query.events.v2", "sales.payment-events.v2"];
const SERVER_ERRORS = (window) =>
  `sum(increase(http_server_request_duration_seconds_count{service_name=~"sales-service|inventory-service|payment-service",http_response_status_code=~"5.."}[${window}]))`;
const BUSINESS_REFUSALS = ["insufficient_stock", "product_unpriced"];

const sum = (values) => values.reduce((total, value) => total + value, 0);
const answered = (response) =>
  response.status === 201 || (response.status === 409 && BUSINESS_REFUSALS.includes(response.body?.code));
const describe = (response) => `${response.status}${response.body?.code ? `/${response.body.code}` : ""}`;

async function unpublishedPerDatabase() {
  return Promise.all(q.OUTBOX_DATABASES.map((db) => q.outboxUnpublished(db)));
}

async function backlogDrained() {
  const old = await Promise.all(q.OUTBOX_DATABASES.map((db) => q.outboxUnpublishedOlderThan(db, 10)));
  return old.every((count) => count === 0);
}

async function consumersAttached(ctx) {
  const queues = await Promise.all(CONSUMER_QUEUES.map((name) => ctx.rabbit.queue(name)));
  return queues.every((queue) => queue.consumers >= 1);
}

async function windowAgreement(from, to) {
  const written = sum(await Promise.all(q.OUTBOX_DATABASES.map((db) => q.outboxWritten(db, from, to))));
  return {
    written,
    applied: await q.reportRowsWritten(from, to),
    distinct: await q.reportRowsDistinctEvents(from, to),
  };
}

export default {
  name: "rabbitmq-outage",
  description: "RabbitMQ stopped for 60 s under checkout load: outbox buffers, consumers reattach, no event lost",
  plan: [
    "t+0 start k6 checkout load (10 VUs); log in as the customer; pick one sellable pickup line",
    "t+30s stop rabbitmq for 60 s; every 10 s place a pickup order, read products, sample the outbox backlog and the Outbox stuck alert",
    "restart rabbitmq; wait for consumers to reattach and for the outbox backlog older than 10 s to drain",
    "stop the load; wait until every outbox row is published and the read models have caught up",
    "check: window events published and applied exactly once, catalog availability and paid orders match, dead-letter queues empty",
  ],

  async preflight(ctx) {
    const from = new Date(Date.now() - 3_600_000);
    const to = new Date();
    const written = await Promise.all(q.OUTBOX_DATABASES.map((db) => q.outboxWritten(db, from, to)));
    ctx.check("dry run: outbox rows in the last hour (inventory, sales, payment)", true, written.join(", "));
    const applied = await q.reportRowsWritten(from, to);
    const distinct = await q.reportRowsDistinctEvents(from, to);
    ctx.check("dry run: operations read model rows in the last hour", true, `${applied} rows, ${distinct} distinct`);
    const catalog = await q.catalogAvailabilityDigest();
    const inventory = await q.inventoryLatestAvailabilityDigest();
    ctx.check(
      "dry run: catalog availability digest matches the latest inventory events",
      catalog.digest === inventory.digest && catalog.count === inventory.count,
      `${catalog.count} pairs`,
    );
    ctx.check("dry run: availability mismatches vs free stock", (await q.inventoryAvailabilityMismatches()) === 0);
    const paid = await q.paidOrderIds(from, to);
    ctx.check("dry run: paid order ids in the last hour", true, `${paid.length} orders`);
    ctx.check("dry run: 5xx metric query", true, `${await ctx.promScalar(SERVER_ERRORS("1h"))} server errors`);
    ctx.check("dry run: k6 failure counter query", true, `${await ctx.load.errors(3600)} failed k6 requests`);
    const states = await ctx.alerts();
    ctx.check('dry run: alert "Outbox stuck" exists', states["Outbox stuck"] !== undefined, states["Outbox stuck"]);
    for (const name of [...CONSUMER_QUEUES, ...q.DEAD_QUEUES]) {
      const queue = await ctx.rabbit.queue(name);
      ctx.check(`dry run: queue ${name}`, true, `${queue.consumers ?? 0} consumers, ${queue.messages} messages`);
    }
  },

  async run(ctx) {
    const orders = [];
    const reads = [];
    const backlog = [];
    const alertStates = new Set();
    try {
      ctx.load.start({ duration: ctx.duration, vus: VUS });
      const customer = await ctx.gateway.login(ACCOUNTS.customer);
      await ctx.sleep(30_000);
      const { store, line } = await sellableLine(customer);

      const stoppedAt = Date.now();
      await ctx.compose.stop("rabbitmq");
      for (let sample = 0; sample < OUTAGE_MS / SAMPLE_MS; sample++) {
        await ctx.sleep(SAMPLE_MS);
        backlog.push(sum(await unpublishedPerDatabase()));
        orders.push(await placeOrder(customer, store.id, "cash_on_delivery", [line]));
        reads.push((await customer.get("/api/products", { limit: 20 })).status);
        alertStates.add((await ctx.alerts())["Outbox stuck"]);
      }
      const outageSeconds = Math.round((Date.now() - stoppedAt) / 1000);
      await ctx.sleep(METRICS_FLUSH_MS);
      const k6Failures = await ctx.load.errors(outageSeconds + METRICS_FLUSH_MS / 1000);
      const serverErrors = await ctx.promScalar(SERVER_ERRORS(`${outageSeconds + 15}s`));
      ctx.note(`orders during outage: ${orders.map(describe).join(", ")}; product reads: ${reads.join(", ")}`);
      ctx.note(
        `outbox backlog per sample: ${backlog.join(", ")}; "Outbox stuck" states (informational): ${[...alertStates].join(", ")}`,
      );

      ctx.check(
        "orders and reads keep answering while RabbitMQ is down",
        orders.every(answered) && reads.every((s) => s === 200),
        orders.map(describe).join(", "),
      );
      ctx.check("k6 load saw no failed requests during the outage", k6Failures === 0, `${k6Failures} failed`);
      ctx.check("no 5xx from sales, inventory or payment during the outage", serverErrors === 0, `${serverErrors}`);
      ctx.check(
        "outbox backlog grows while the broker is down",
        Math.max(...backlog) > 0,
        `peak ${Math.max(...backlog)}`,
      );

      await ctx.compose.start("rabbitmq");
      await ctx.compose.waitHealthy("rabbitmq", 180_000);
      ctx.check("rabbitmq healthy after start", true);
      await ctx.waitFor("consumers reattached to their queues", () => consumersAttached(ctx), {
        timeoutMs: 180_000,
        intervalMs: 3_000,
      });
      ctx.check("consumers reattached to their queues", true);
      await ctx.waitFor("outbox backlog older than 10 s drained", backlogDrained, {
        timeoutMs: 240_000,
        intervalMs: 3_000,
      });
      ctx.check("outbox publishers reconnected and backlog drained", true);

      await ctx.load.stop();
      const to = new Date();
      const from = new Date(stoppedAt - 5_000);
      await ctx.waitFor(
        "every outbox row published",
        async () => (await unpublishedPerDatabase()).every((n) => n === 0),
        { timeoutMs: 120_000, intervalMs: 3_000 },
      );
      const unpublished = sum(
        await Promise.all(q.OUTBOX_DATABASES.map((db) => q.outboxUnpublishedWritten(db, from, to))),
      );
      ctx.check("every event written in the window was published", unpublished === 0, `${unpublished} unpublished`);

      const agreed = await ctx.waitFor(
        "operations read model applied every window event exactly once",
        async () => {
          const { written, applied, distinct } = await windowAgreement(from, to);
          return written > 0 && written === applied && applied === distinct ? { written } : false;
        },
        { timeoutMs: 240_000, intervalMs: 5_000 },
      );
      ctx.check("operations read model applied each window event exactly once", true, `${agreed.written} events`);

      await ctx.waitFor(
        "catalog availability equals the latest availability event per product and site",
        async () => {
          const catalog = await q.catalogAvailabilityDigest();
          const inventory = await q.inventoryLatestAvailabilityDigest();
          return catalog.digest === inventory.digest && catalog.count === inventory.count;
        },
        { timeoutMs: 180_000, intervalMs: 5_000 },
      );
      ctx.check("catalog availability equals the latest availability event per product and site", true);

      const paid = await q.paidOrderIds(from, to);
      await ctx.waitFor(
        "sales marked every window payment as paid",
        async () => (await q.countPaidOrders(paid)) === paid.length,
        { timeoutMs: 180_000, intervalMs: 5_000 },
      );
      ctx.check("sales applied every window payment event", true, `${paid.length} orders`);

      for (const name of q.DEAD_QUEUES) {
        const queue = await ctx.rabbit.queue(name);
        ctx.check(`dead-letter queue ${name} is empty`, queue.messages === 0, `${queue.messages} messages`);
      }
    } finally {
      await ctx.restoreAll();
    }
  },
};
