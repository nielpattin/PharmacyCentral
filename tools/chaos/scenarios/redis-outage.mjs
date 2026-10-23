// Redis stopped for 45 s. Only sales-service uses Redis, for two things, verified in its code:
// - the delivery route cache fails open: a cache error is ignored and the route is priced again;
// - the photo-intake rate limiter fails closed: it answers 503 rate_limit_unavailable.
// Pickup checkout has no Redis dependency, so it must keep working with no 5xx storm. Intake answers
// reader_unavailable before it reaches the limiter when no prescription reader is configured; the scenario reports which.
import { ACCOUNTS } from "../lib/gateway.mjs";
import { TINY_PNG, placeOrder, sellableLine } from "../lib/shop.mjs";

const VUS = 10;
const OUTAGE_TICKS = 3;
const TICK_MS = 15_000;
const BUSINESS_REFUSALS = ["insufficient_stock", "product_unpriced"];
const CLEAN_INTAKE_CODES = ["rate_limit_unavailable", "reader_unavailable"];
const SALES_REQUESTS = (window) =>
  `sum(increase(http_server_request_duration_seconds_count{service_name="sales-service"}[${window}]))`;
const SALES_SERVER_ERRORS = (window) =>
  `sum(increase(http_server_request_duration_seconds_count{service_name="sales-service",http_response_status_code=~"5.."}[${window}]))`;

const orderAccepted = (response) =>
  response.status === 201 || (response.status === 409 && BUSINESS_REFUSALS.includes(response.body?.code));
const describe = (response) => `${response.status}${response.body?.code ? `/${response.body.code}` : ""}`;
const intake = (client) => client.postRaw("/api/prescriptions/intake/image", TINY_PNG, "image/png");

async function probeCheckout(customer) {
  const { store, line } = await sellableLine(customer);
  return {
    cash: await placeOrder(customer, store.id, "cash_on_delivery", [line]),
    qr: await placeOrder(customer, store.id, "sepay_qr", [line]),
  };
}

export default {
  name: "redis-outage",
  description: "Redis stopped for 45 s: checkout keeps working, the photo limiter fails closed, full recovery",
  plan: [
    "t+0 start k6 checkout load; log in as the customer",
    "t+20s stop redis for 45 s; every 15 s place a cash and a sepay_qr pickup order and send a photo intake",
    "check the sales 5xx ratio during the outage and that the photo intake answers a clean 503 problem",
    "restart redis; wait until checkout places orders again and the intake no longer reports the limiter down",
    "delivery route cache is verified in code only: a delivery quote needs an address and external route providers",
  ],

  async preflight(ctx) {
    const anonymous = ctx.gateway.anonymous();
    const stores = await anonymous.get("/api/stores", { limit: 1 });
    ctx.check("dry run: store list answers", stores.status === 200, `status ${stores.status}`);
    ctx.check(
      "dry run: sales request metric",
      true,
      `${await ctx.promScalar(SALES_REQUESTS("1h"))} requests in the last hour`,
    );
    ctx.check("dry run: sales 5xx metric", true, `${await ctx.promScalar(SALES_SERVER_ERRORS("1h"))} errors`);
  },

  async run(ctx) {
    try {
      ctx.load.start({ duration: ctx.duration, vus: VUS });
      const customer = await ctx.gateway.login(ACCOUNTS.customer);
      await ctx.sleep(20_000);

      await ctx.compose.stop("redis");
      const stoppedAt = Date.now();
      const checkout = [];
      const photos = [];
      for (let tick = 0; tick < OUTAGE_TICKS; tick++) {
        if (tick > 0) await ctx.sleep(TICK_MS);
        checkout.push(await probeCheckout(customer));
        photos.push(await intake(customer));
      }
      const outageSeconds = Math.round((Date.now() - stoppedAt) / 1000);
      ctx.note(
        `checkout during outage (cash, sepay_qr): ${checkout.map((c) => `${describe(c.cash)} ${describe(c.qr)}`).join("; ")}`,
      );
      ctx.note(`photo intake during outage: ${photos.map(describe).join(", ")}`);

      const window = `${outageSeconds + 60}s`;
      const requests = await ctx.promScalar(SALES_REQUESTS(window));
      const serverErrors = await ctx.promScalar(SALES_SERVER_ERRORS(window));
      ctx.check(
        "checkout places cash and sepay_qr pickup orders with redis down",
        checkout.every((probe) => orderAccepted(probe.cash) && orderAccepted(probe.qr)),
        checkout.map((probe) => `${describe(probe.cash)} ${describe(probe.qr)}`).join("; "),
      );
      ctx.check(
        "sales-service 5xx stays under 1% during the outage (photo 503s included)",
        requests === 0 || serverErrors / requests <= 0.01,
        `${serverErrors} of ${requests} requests`,
      );
      ctx.check(
        "photo intake answers a clean problem response while redis is down",
        photos.every((response) => response.status === 503 && CLEAN_INTAKE_CODES.includes(response.body?.code)),
        photos.map(describe).join(", "),
      );
      const limiterReached = photos.some((response) => response.body?.code === "rate_limit_unavailable");
      ctx.note(
        limiterReached
          ? "photo intake reached the Redis limiter and failed closed"
          : "photo intake stopped at reader_unavailable: the limiter was not reached (no prescription reader configured)",
      );

      await ctx.compose.start("redis");
      await ctx.compose.waitHealthy("redis", 120_000);
      await ctx.waitFor(
        "checkout places orders again after redis restarts",
        async () => orderAccepted((await probeCheckout(customer)).cash),
        {
          timeoutMs: 180_000,
          intervalMs: 5_000,
        },
      );
      ctx.check("checkout recovered after redis restarts", true);
      const after = await intake(customer);
      ctx.check(
        "photo intake no longer reports the limiter unavailable",
        after.body?.code !== "rate_limit_unavailable",
        describe(after),
      );
    } finally {
      await ctx.load.stop();
      await ctx.restoreAll();
    }
  },
};
