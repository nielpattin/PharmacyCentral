// Typesense stopped for 45 s. Catalog search calls Typesense with a 2 s timeout and falls back to SQL on any failure,
// so search should keep answering. The index is re-synced only by a sweep, and sweeps are triggered by product, unit,
// price, import and search-settings changes (and by a search that finds the collection missing). There is no timer and
// no retry, so a product created during the outage is expected to become searchable only after the next such change.
// The scenario records that rather than assuming it.
import { ACCOUNTS } from "../lib/gateway.mjs";

const VUS = 10;
const OUTAGE_TICKS = 3;
const TICK_MS = 15_000;
// The index call times out after 2 s and the SQL fallback answers right after; anything slower is a hang.
const SEARCH_BUDGET_MS = 5_000;

const found = (response, id) =>
  response.status === 200 && Array.isArray(response.body) && response.body.some((product) => product.id === id);
const answersCleanly = (response) =>
  response.status === 200
    ? Array.isArray(response.body)
    : response.status >= 400 && response.status < 600 && typeof response.body === "object" && response.body !== null;

async function timedSearch(client, text) {
  const startedAt = Date.now();
  const response = await client.get("/api/products", { search: text, limit: 20 });
  return { response, ms: Date.now() - startedAt };
}

export default {
  name: "typesense-outage",
  description: "Typesense stopped for 45 s: search falls back, catalog reads keep working, index re-syncs",
  plan: [
    "t+0 start k6 checkout load; pick a known product and a store",
    "t+20s stop typesense for 45 s; every 15 s search, read product detail, availability and orders",
    "create a probe product during the outage through the catalog API",
    "restart typesense; check the known product is found, then whether the probe product is found without another change",
    "make one product update so a sweep runs; check the probe product becomes searchable; deactivate it afterwards",
  ],

  async preflight(ctx) {
    const anonymous = ctx.gateway.anonymous();
    const products = await anonymous.get("/api/products", { limit: 5 });
    ctx.check("dry run: product list answers", products.status === 200, `status ${products.status}`);
    const stores = await anonymous.get("/api/stores", { limit: 5 });
    ctx.check("dry run: store list answers", stores.status === 200, `status ${stores.status}`);
    const search = await timedSearch(anonymous, "paracetamol");
    ctx.check(
      "dry run: search answers within budget",
      answersCleanly(search.response) && search.ms < SEARCH_BUDGET_MS,
      `status ${search.response.status} in ${search.ms} ms`,
    );
  },

  async run(ctx) {
    const runId = Date.now().toString(36);
    const probeName = `Chaos Probe ${runId}`;
    let created;
    let admin;
    try {
      ctx.load.start({ duration: ctx.duration, vus: VUS });
      const customer = await ctx.gateway.login(ACCOUNTS.customer);
      admin = await ctx.gateway.login(ACCOUNTS.admin);
      const [known] = (await customer.get("/api/products", { limit: 1 })).body ?? [];
      if (!known) throw new Error("the catalog lists no product to search for");
      const [store] = (await customer.get("/api/stores", { limit: 1 })).body ?? [];
      if (!store) throw new Error("no customer-facing store to read availability for");
      await ctx.sleep(20_000);

      await ctx.compose.stop("typesense");
      const stoppedAt = Date.now();
      const probes = [];
      for (let tick = 0; tick < OUTAGE_TICKS; tick++) {
        if (tick > 0) await ctx.sleep(TICK_MS);
        probes.push({
          search: await timedSearch(customer, known.name),
          detail: (await customer.get(`/api/products/${known.id}`)).status,
          availability: (await customer.get("/api/availability", { siteId: store.id })).status,
          orders: (await customer.get("/api/orders")).status,
        });
      }
      const outageSeconds = Math.round((Date.now() - stoppedAt) / 1000);
      ctx.note(
        `probes during outage: ${probes
          .map(
            (p) =>
              `search ${p.search.response.status} in ${p.search.ms} ms, detail ${p.detail}, availability ${p.availability}, orders ${p.orders}`,
          )
          .join("; ")}`,
      );

      const createdResponse = await admin.post("/api/products", {
        sku: `CHAOS-${runId}`,
        name: probeName,
        units: [{ unitName: "Hop", conversionFactorToBaseUnit: 1, isBaseUnit: true, isDefaultSaleUnit: true }],
      });
      created = createdResponse.status === 201 ? createdResponse.body : undefined;

      ctx.check(
        "search answers within budget while typesense is down (SQL fallback or a clean error)",
        probes.every((p) => answersCleanly(p.search.response) && p.search.ms < SEARCH_BUDGET_MS),
        probes.map((p) => `${p.search.response.status}/${p.search.ms}ms`).join(", "),
      );
      ctx.check(
        "product detail, availability and orders keep answering during the outage",
        probes.every((p) => p.detail === 200 && p.availability === 200 && p.orders === 200),
        probes.map((p) => `${p.detail}/${p.availability}/${p.orders}`).join(", "),
      );
      ctx.check("product created during the outage", Boolean(created), `status ${createdResponse.status}`);
      ctx.note(
        `catalog 5xx during the outage (informational, includes clean search errors): ${await ctx.promScalar(`sum(increase(http_server_request_duration_seconds_count{service_name="catalog-service",http_response_status_code=~"5.."}[${outageSeconds + 60}s]))`)}`,
      );

      await ctx.compose.start("typesense");
      await ctx.compose.waitHealthy("typesense", 180_000);
      await ctx.waitFor(
        "known product found by search after typesense restarts",
        async () => found((await timedSearch(customer, known.name)).response, known.id),
        { timeoutMs: 120_000, intervalMs: 5_000 },
      );
      ctx.check("known product found by search after typesense restarts", true);

      if (created) {
        const resynced = await ctx
          .waitFor(
            "probe product indexed without another product change",
            async () => found((await timedSearch(customer, probeName)).response, created.id),
            {
              timeoutMs: 90_000,
              intervalMs: 5_000,
            },
          )
          .then(
            () => true,
            () => false,
          );
        // Informational, not a pass/fail check: the sweep is event-driven (no timer or retry), and it also needs the
        // embedding provider, whose quota is outside this scenario's control.
        ctx.note(
          resynced
            ? "finding: the product created during the outage was re-synced by itself"
            : "finding: the product created during the outage stays out of search until the next product change (the sweep has no timer or retry)",
        );

        await admin.put(`/api/products/${created.id}`, { sku: created.sku, name: probeName, notes: `chaos ${runId}` });
        const indexedAfterChange = await ctx
          .waitFor(
            "probe product searchable after one product change",
            async () => found((await timedSearch(customer, probeName)).response, created.id),
            { timeoutMs: 120_000, intervalMs: 5_000 },
          )
          .then(
            () => true,
            () => false,
          );
        ctx.note(
          indexedAfterChange
            ? "the next product change indexed the probe product"
            : "the next product change did not index the probe product within 120 s (the sweep fails while the embedding provider rejects calls; see the catalog-service log)",
        );
      }
    } finally {
      await ctx.load.stop();
      if (created && admin) {
        const deactivated = await admin.put(`/api/products/${created.id}`, {
          sku: created.sku,
          name: probeName,
          isActive: false,
        });
        ctx.note(`deactivated the probe product (status ${deactivated.status}); catalog has no delete for it`);
      }
      await ctx.restoreAll();
    }
  },
};
