// sales-service SIGKILLed at a random moment under load and started again 15 s later. Afterwards the books must agree
// across services: every order has its lines; the orders holding stock are exactly the active inventory reservations;
// reserved quantities match their reservation lines; cancelled orders gave their stock back; every payment that
// payment-service recorded reached sales; and each sales event written before the kill was applied exactly once.
import * as q from "../lib/queries.mjs";
import { ACCOUNTS } from "../lib/gateway.mjs";
import { placeOrder, sellableLine } from "../lib/shop.mjs";

const VUS = 10;
const DOWN_MS = 15_000;
const KILL_EARLIEST_MS = 40_000;
const KILL_LATEST_MS = 100_000;
const TAIL_MS = 60_000;

const answered = (response) =>
  response.status === 201 ||
  (response.status === 409 && ["insufficient_stock", "product_unpriced"].includes(response.body?.code));

/** A random moment in the load, after it has warmed up and with time left to recover before the load ends. */
function killDelayMs(duration) {
  const latest = Math.min(KILL_LATEST_MS, duration * 1000 - TAIL_MS);
  if (latest <= KILL_EARLIEST_MS)
    throw new Error(
      `--duration ${duration} leaves no room for a kill and a recovery (need > ${(KILL_EARLIEST_MS + TAIL_MS) / 1000}s)`,
    );
  return KILL_EARLIEST_MS + Math.random() * (latest - KILL_EARLIEST_MS);
}

export default {
  name: "sales-kill",
  description: "sales-service SIGKILLed mid-load, restarted after 15 s: no half-written orders, no stock drift",
  plan: [
    "t+0 start k6 checkout load",
    "t+40..100s (random) SIGKILL sales-service; keep it down 15 s; start it again; wait until checkout places orders",
    "stop the load; wait for sales outbox rows written before the kill to publish and for cancelled holds to drain",
    "check order lines, reservation drift, order holds = active reservations, availability digests, payments reaching sales",
    "check every sales event written before the kill is applied exactly once by the operations read model",
  ],

  async preflight(ctx) {
    const now = new Date();
    const origin = new Date(0);
    ctx.check("dry run: orders without lines", (await q.ordersWithoutLines()) === 0);
    ctx.check("dry run: reservation drift", true, `${await q.reservationDrift()} balances`);
    ctx.check(
      "dry run: held lines on inactive reservations",
      true,
      `${await q.heldLinesOnInactiveReservations()} lines`,
    );
    ctx.check("dry run: cancelled orders holding stock", true, `${await q.cancelledOrdersHolding()} orders`);
    const holds = await q.heldOrderDigest();
    const reservations = await q.activeReservationOwnerDigest();
    ctx.check(
      "dry run: order holds vs active reservations",
      true,
      `${holds.count} held orders, ${reservations.count} active reservations, same set: ${holds.digest === reservations.digest}`,
    );
    ctx.check("dry run: availability mismatches", true, `${await q.inventoryAvailabilityMismatches()} pairs`);
    ctx.check(
      "dry run: sales outbox unpublished before now",
      true,
      `${await q.outboxUnpublishedBefore(q.SALES, now)} rows`,
    );
    ctx.check(
      "dry run: sales events in the whole history",
      true,
      `${await q.outboxWrittenOfType(q.SALES, "sales.", origin, now)} rows`,
    );
    ctx.check(
      "dry run: operations sales rows",
      true,
      `${await q.reportRowsWrittenOfPrefix("sales.", origin, now)} rows, ${await q.reportRowsDistinctEventsOfPrefix("sales.", origin, now)} distinct`,
    );
    const paid = await q.paidOrderIds(origin, now);
    ctx.check("dry run: paid orders reached sales", true, `${await q.countPaidOrders(paid)} of ${paid.length}`);
    ctx.check("dry run: sales container readable", true, JSON.stringify(await ctx.compose.ps("sales-service")));
    ctx.note(
      `dry run: a kill would land between ${KILL_EARLIEST_MS / 1000}s and ${Math.min(KILL_LATEST_MS, ctx.duration * 1000 - TAIL_MS) / 1000}s into the load`,
    );
  },

  async run(ctx) {
    try {
      ctx.load.start({ duration: ctx.duration, vus: VUS });
      const scenarioStart = new Date();
      const delay = killDelayMs(ctx.duration);
      await ctx.sleep(delay);

      const killedAt = new Date();
      await ctx.compose.kill("sales-service", "SIGKILL");
      await ctx.sleep(DOWN_MS);
      await ctx.compose.start("sales-service");
      await ctx.compose.waitHealthy("sales-service", 180_000);

      const customer = await ctx.gateway.login(ACCOUNTS.customer);
      await ctx.waitFor(
        "checkout places orders again after sales restarts",
        async () => {
          const { store, line } = await sellableLine(customer);
          return answered(await placeOrder(customer, store.id, "cash_on_delivery", [line]));
        },
        { timeoutMs: 180_000, intervalMs: 5_000 },
      );
      ctx.check("checkout recovered after sales restarts", true);

      await ctx.load.stop();
      const to = new Date();
      await ctx.waitFor(
        "sales outbox rows written before the kill are all published",
        async () => (await q.outboxUnpublishedBefore(q.SALES, killedAt)) === 0,
        {
          timeoutMs: 240_000,
          intervalMs: 5_000,
        },
      );
      ctx.check("sales outbox rows written before the kill are all published", true);

      await ctx.waitFor(
        "cancelled orders have given back their holds",
        async () => (await q.cancelledOrdersHolding()) === 0,
        { timeoutMs: 240_000, intervalMs: 10_000 },
      );
      ctx.check("no cancelled order still holds stock", true);

      const lineless = await q.ordersWithoutLines();
      ctx.check("every order has at least one line", lineless === 0, `${lineless} orders without lines`);
      const drift = await q.reservationDrift();
      ctx.check(
        "reserved quantity equals the lines of active reservations on every balance",
        drift === 0,
        `${drift} balances differ`,
      );
      const inactive = await q.heldLinesOnInactiveReservations();
      ctx.check("no released or consumed reservation still holds stock", inactive === 0, `${inactive} lines`);

      await ctx.waitFor(
        "order holds equal the active inventory reservations",
        async () => {
          // Only this run's orders: reservations left by earlier runs or demo data have no order to compare with.
          const holds = await q.heldOrderDigest(scenarioStart);
          const reservations = await q.activeReservationOwnerDigest(scenarioStart);
          return holds.count === reservations.count && holds.digest === reservations.digest;
        },
        { timeoutMs: 240_000, intervalMs: 5_000 },
      );
      ctx.check("orders holding stock are exactly the active inventory reservations", true);

      await ctx.waitFor(
        "catalog availability equals the latest availability event",
        async () => {
          const catalog = await q.catalogAvailabilityDigest();
          const inventory = await q.inventoryLatestAvailabilityDigest();
          return catalog.digest === inventory.digest && catalog.count === inventory.count;
        },
        { timeoutMs: 180_000, intervalMs: 5_000 },
      );
      ctx.check("catalog availability equals the latest availability event", true);
      const mismatches = await q.inventoryAvailabilityMismatches();
      ctx.check(
        "latest availability events agree with free stock in inventory",
        mismatches === 0,
        `${mismatches} pairs`,
      );

      const paid = await q.paidOrderIds(scenarioStart, to);
      await ctx.waitFor(
        "sales marked every payment that payment-service recorded as paid",
        async () => (await q.countPaidOrders(paid)) === paid.length,
        {
          timeoutMs: 240_000,
          intervalMs: 5_000,
        },
      );
      ctx.check("no payment is stranded between payment-service and sales", true, `${paid.length} orders`);

      const published = await q.outboxWrittenOfType(q.SALES, "sales.", scenarioStart, killedAt);
      await ctx.waitFor(
        "operations read model applied each sales event before the kill exactly once",
        async () => {
          const applied = await q.reportRowsWrittenOfPrefix("sales.", scenarioStart, killedAt);
          const distinct = await q.reportRowsDistinctEventsOfPrefix("sales.", scenarioStart, killedAt);
          return published > 0 && applied === published && distinct === published;
        },
        { timeoutMs: 240_000, intervalMs: 5_000 },
      );
      ctx.check("sales events written before the kill applied exactly once", true, `${published} events`);

      ctx.note(
        `unpaid orders still holding stock from before the kill: ${await q.pendingOrdersHoldingSince(killedAt)} (released by the expiry sweep)`,
      );
    } finally {
      await ctx.load.stop();
      await ctx.restoreAll();
    }
  },
};
