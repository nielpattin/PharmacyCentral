#!/usr/bin/env node
// Chaos against the deployed AWS stack (ECS Fargate, us-east-1). Same idea as ../runner.mjs, different reach: faults are
// injected through the ECS API, and every invariant is read through the public API, because RDS and Typesense are
// private. Only the routes many shoppers use are exercised (browse, search, sign-in, order list); the background load is
// the steady browse k6 script, aimed at CHAOS_BASE_URL. Checkout, payment, import and the chatbot are out of scope.
// Usage: pnpm run chaos:aws <scenario|all> [--duration 240]
import { setTimeout as delay } from "node:timers/promises";

import { ACCOUNTS, GatewayClient, baseUrl } from "../lib/gateway.mjs";
import { createLoad } from "../lib/load.mjs";
import { promScalar } from "../lib/observability.mjs";
import { createEcs } from "../lib/ecs.mjs";
import { requiredEnv } from "../lib/env.mjs";

// Browse journeys per second held for the whole scenario: the load level the 6 vCPU stack served with 0% errors.
const RATE = 20;

function createContext(name, duration) {
  const started = Date.now();
  const checks = [];
  const cleanups = [];
  const note = (text) => console.log(`  [${name}] +${((Date.now() - started) / 1000).toFixed(1)}s ${text}`);
  const onCleanup = (label, undo) => cleanups.push({ label, undo });
  const load = createLoad({ note });
  const ecs = createEcs({ note, onCleanup });
  const ctx = {
    name,
    duration,
    note,
    ecs,
    sleep: (ms) => delay(ms),
    gateway: { login: (email) => new GatewayClient().login(email), anonymous: () => new GatewayClient() },
    load: {
      start(options) {
        load.start(options);
        onCleanup("stop the k6 load", () => load.stop());
      },
      stop: () => load.stop(),
      result: () => load.result(),
      /** Failed and total k6 requests in the last `seconds`, from the local Prometheus that k6 writes to. */
      async window(seconds) {
        const w = `${Math.round(seconds)}s`;
        const [errors, requests] = await Promise.all([
          promScalar(`sum(increase(k6_chaos_http_errors_total[${w}]))`),
          promScalar(`sum(increase(k6_chaos_http_requests_total[${w}]))`),
        ]);
        return { errors: Math.round(errors), requests: Math.round(requests) };
      },
    },
    async waitFor(label, probe, { timeoutMs = 180_000, intervalMs = 3_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let last;
      for (;;) {
        try {
          last = await probe();
          if (last) return last;
        } catch (error) {
          last = `error: ${error.message}`;
        }
        if (Date.now() >= deadline)
          throw new Error(
            `${label} not reached within ${Math.round(timeoutMs / 1000)}s; last: ${JSON.stringify(last)?.slice(0, 300)}`,
          );
        await delay(intervalMs);
      }
    },
    check(label, ok, detail = "") {
      checks.push({ label, passed: Boolean(ok), detail: String(detail).slice(0, 300) });
      note(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${String(detail).slice(0, 200)})` : ""}`);
      return Boolean(ok);
    },
    async restoreAll() {
      while (cleanups.length > 0) {
        const { label, undo } = cleanups.pop();
        try {
          await undo();
          note(`restored: ${label}`);
        } catch (error) {
          note(`restore failed (${label}): ${error.message}`);
        }
      }
    },
  };
  return { ctx, checks };
}

const seconds = (since) => Math.round((Date.now() - since) / 1000);

// ------------------------------------------------------------------------------------------------ scenarios
const scenarios = [
  {
    name: "typesense-outage",
    description: "Typesense service scaled to 0 for 45 s: search falls back to SQL, reads keep working, search recovers",
    async run(ctx) {
      const runId = Date.now().toString(36);
      const probeName = `Chaos Probe ${runId}`;
      let manager;
      let created;
      try {
        ctx.load.start({ duration: ctx.duration, rate: RATE });
        const customer = await ctx.gateway.login(ACCOUNTS.customer);
        manager = await ctx.gateway.login(ACCOUNTS.manager);
        const [known] = (await customer.get("/api/products", { limit: 1 })).body ?? [];
        const [store] = (await customer.get("/api/stores", { limit: 1 })).body ?? [];
        if (!known || !store) throw new Error("no product or store to probe");
        const search = async () => {
          const t = Date.now();
          const response = await customer.get("/api/products", { search: known.name, limit: 20 });
          return { response, ms: Date.now() - t };
        };
        const before = await search();
        ctx.note(`search before the fault: ${before.response.status} in ${before.ms} ms`);
        await ctx.sleep(20_000);
        await ctx.ecs.stop("typesense");
        const stoppedAt = Date.now();
        const probes = [];
        for (let i = 0; i < 3; i++) {
          if (i > 0) await ctx.sleep(15_000);
          probes.push({
            search: await search(),
            detail: (await customer.get(`/api/products/${known.id}`)).status,
            availability: (await customer.get("/api/availability", { siteId: store.id })).status,
            orders: (await customer.get("/api/orders")).status,
          });
        }
        ctx.check(
          "search answers 200 within 5 s while Typesense is down (SQL fallback)",
          probes.every((p) => p.search.response.status === 200 && p.search.ms < 5_000),
          probes.map((p) => `${p.search.response.status}/${p.search.ms}ms`).join(", "),
        );
        ctx.check(
          "detail, availability and orders keep answering 200",
          probes.every((p) => p.detail === 200 && p.availability === 200 && p.orders === 200),
          probes.map((p) => `${p.detail}/${p.availability}/${p.orders}`).join(", "),
        );
        const createdResponse = await manager.post("/api/products", {
          sku: `CHAOS-${runId}`,
          name: probeName,
          units: [{ unitName: "Hop", conversionFactorToBaseUnit: 1, isBaseUnit: true, isDefaultSaleUnit: true }],
        });
        created = createdResponse.status === 201 ? createdResponse.body : undefined;
        ctx.check("a product can be created while Typesense is down", Boolean(created), `status ${createdResponse.status}`);
        const remaining = 45_000 - (Date.now() - stoppedAt);
        if (remaining > 0) await ctx.sleep(remaining);
        const restoreAt = Date.now();
        await ctx.ecs.start("typesense");
        await ctx.ecs.waitHealthy("typesense");
        await ctx.waitFor(
          "search finds the known product again",
          async () => {
            const r = await search();
            return r.response.status === 200 && r.response.body?.some((p) => p.id === known.id);
          },
          { timeoutMs: 300_000, intervalMs: 5_000 },
        );
        ctx.check("search finds the known product after Typesense restarts", true, `${seconds(restoreAt)} s after the restore`);
        if (created) {
          const resynced = await ctx
            .waitFor(
              "the product created during the outage is searchable",
              async () => {
                const r = await customer.get("/api/products", { search: probeName, limit: 20 });
                return r.status === 200 && r.body?.some((p) => p.id === created.id);
              },
              { timeoutMs: 90_000, intervalMs: 5_000 },
            )
            .then(
              () => true,
              () => false,
            );
          ctx.note(
            resynced
              ? "finding: the product created during the outage was re-synced by itself"
              : "finding: the product created during the outage stays out of search until the next product change",
          );
        }
      } finally {
        if (created && manager) {
          await manager
            .put(`/api/products/${created.id}`, { sku: created.sku, name: probeName, isActive: false })
            .catch(() => undefined);
        }
      }
    },
  },

  {
    name: "catalog-kill",
    description: "every catalog-service task stopped under browse load: ECS replaces them, browse and search recover",
    async run(ctx) {
      ctx.load.start({ duration: ctx.duration, rate: RATE });
      const guest = ctx.gateway.anonymous();
      await ctx.sleep(30_000);
      const read = async () => {
        const t = Date.now();
        // Stores are served by catalog-service itself; the product list goes to search-service and survives its loss.
        const list = await guest.get("/api/stores", { limit: 5 }).catch(() => ({ status: 0 }));
        return { status: list.status, ms: Date.now() - t };
      };
      await ctx.ecs.killTasks("catalog-service");
      const killedAt = Date.now();
      let firstFailure;
      let recoveredAt;
      for (;;) {
        const r = await read();
        if (r.status !== 200) firstFailure ??= Date.now();
        if (r.status === 200 && firstFailure) {
          recoveredAt = Date.now();
          break;
        }
        if (Date.now() - killedAt > 300_000) break;
        await ctx.sleep(3_000);
      }
      ctx.check(
        "product reads fail while the tasks are gone (the fault was felt)",
        firstFailure !== undefined,
        firstFailure ? `after ${Math.round((firstFailure - killedAt) / 1000)} s` : "never failed",
      );
      ctx.check(
        "product reads answer 200 again after ECS replaces the tasks",
        recoveredAt !== undefined,
        recoveredAt ? `recovery time ${Math.round((recoveredAt - killedAt) / 1000)} s` : "not within 300 s",
      );
      await ctx.ecs.waitHealthy("catalog-service");
      const after = await Promise.all([
        guest.get("/api/stores", { limit: 5 }),
        guest.get("/api/products", { search: "paracetamol", limit: 20 }),
      ]);
      ctx.check("stores and search answer 200 after the recovery", after.every((r) => r.status === 200), after.map((r) => r.status).join(", "));
      const w = await ctx.load.window(seconds(killedAt) + 10);
      ctx.note(`k6 since the kill: ${w.requests} requests, ${w.errors} failed`);
    },
  },

  {
    name: "identity-kill",
    description: "every identity-service task stopped under browse load: guests keep browsing, sign-in returns after the replacement",
    async run(ctx) {
      ctx.load.start({ duration: ctx.duration, rate: RATE });
      const anonymous = ctx.gateway.anonymous();
      await ctx.sleep(30_000);
      await ctx.ecs.killTasks("identity-service");
      const killedAt = Date.now();
      const guestReads = [];
      let loginFailed;
      let loginRecoveredAt;
      for (;;) {
        guestReads.push((await anonymous.get("/api/products", { limit: 5 }).catch(() => ({ status: 0 }))).status);
        const login = await ctx.gateway.login(ACCOUNTS.customer).then(
          () => true,
          () => false,
        );
        if (!login) loginFailed ??= Date.now();
        if (login && loginFailed) {
          loginRecoveredAt = Date.now();
          break;
        }
        if (Date.now() - killedAt > 300_000) break;
        await ctx.sleep(3_000);
      }
      ctx.check(
        "sign-in fails while the tasks are gone (the fault was felt)",
        loginFailed !== undefined,
        loginFailed ? `after ${Math.round((loginFailed - killedAt) / 1000)} s` : "never failed",
      );
      ctx.check(
        "sign-in works again after ECS replaces the tasks",
        loginRecoveredAt !== undefined,
        loginRecoveredAt ? `recovery time ${Math.round((loginRecoveredAt - killedAt) / 1000)} s` : "not within 300 s",
      );
      const okGuest = guestReads.filter((s) => s === 200).length;
      ctx.note(`guest product reads during the outage: ${okGuest} of ${guestReads.length} answered 200`);
      await ctx.ecs.waitHealthy("identity-service");
      const w = await ctx.load.window(seconds(killedAt) + 10);
      ctx.note(`k6 since the kill: ${w.requests} requests, ${w.errors} failed`);
    },
  },
];

// ------------------------------------------------------------------------------------------------ runner
function describeLoad(load) {
  if (!load?.summary) return load ? `k6 exit ${load.exitCode}, no summary` : "no load";
  const s = load.summary;
  const pct = s.httpRequests > 0 ? ((s.httpFailed / s.httpRequests) * 100).toFixed(2) : "0.00";
  return `k6 exit ${load.exitCode}: ${s.iterations} iterations, ${s.httpRequests} requests, ${s.httpFailed} failed (${pct}%), ${s.businessRejections} business refusals`;
}

async function main() {
  const argv = process.argv.slice(2);
  const which = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--duration");
  const di = argv.indexOf("--duration");
  const duration = di >= 0 ? Number(argv[di + 1]) : 240;
  if (!which) throw new Error("usage: pnpm run chaos:aws <scenario|all> [--duration 240]");
  for (const n of ["CHAOS_BASE_URL", "DEMO_ACCOUNT_PASSWORD", "GRAFANA_PORT"]) requiredEnv(n);
  console.log(`target ${baseUrl()}`);
  const names = which.split(",");
  const selected = which === "all" ? scenarios : scenarios.filter((s) => names.includes(s.name));
  if (selected.length === 0 || (which !== "all" && selected.length !== names.length))
    throw new Error(`unknown scenario ${which}; available: all, ${scenarios.map((s) => s.name).join(", ")}`);
  let current;
  const onSignal = (signal) => {
    console.error(`\n${signal}: restoring the stack before exit`);
    (current?.ctx.restoreAll() ?? Promise.resolve()).finally(() => process.exit(130));
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  let allPassed = true;
  const results = [];
  for (const scenario of selected) {
    const made = createContext(scenario.name, duration);
    current = made;
    console.log(`\n=== ${scenario.name}: ${scenario.description}`);
    let error;
    try {
      await scenario.run(made.ctx);
    } catch (caught) {
      error = caught;
    } finally {
      await made.ctx.load.stop().catch(() => undefined);
      await made.ctx.restoreAll();
      current = undefined;
    }
    const load = await made.ctx.load.result();
    results.push({ name: scenario.name, checks: made.checks, error, load });
  }
  for (const r of results) {
    const passed = r.checks.filter((c) => c.passed).length;
    const ok = !r.error && passed === r.checks.length;
    allPassed &&= ok;
    console.log(`\n${r.name}: ${ok ? "PASS" : "FAIL"} (${passed}/${r.checks.length} checks passed)`);
    console.log(`  load: ${describeLoad(r.load)}`);
    for (const c of r.checks) console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.label}${c.detail ? `  -- ${c.detail}` : ""}`);
    if (r.error) console.log(`  FAIL  scenario threw: ${r.error.message}`);
  }
  process.exitCode = allPassed ? 0 : 1;
}

main().catch((error) => {
  console.error(`chaos aws runner: ${error.message}`);
  process.exitCode = 1;
});
