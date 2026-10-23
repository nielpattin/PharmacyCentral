import { setTimeout as delay } from "node:timers/promises";

import { composeCli, containerOf, waitHealthy } from "./compose.mjs";
import { ACCOUNTS, GatewayClient, postSepayWebhook } from "./gateway.mjs";
import { createLoad } from "./load.mjs";
import { alerts, prom, promScalar } from "./observability.mjs";
import { rabbit } from "./rabbit.mjs";
import { sql, sqlJson, sqlNumber } from "./postgres.mjs";

export class DryRunRefusal extends Error {
  constructor(action) {
    super(`dry run refuses to ${action}`);
    this.name = "DryRunRefusal";
  }
}

/**
 * Everything a scenario touches. Every mutation registers its undo before it runs, and `restoreAll` (called from a
 * scenario's finally block, after a failure, or on Ctrl-C) runs the undos newest first: containers start again,
 * paused containers unpause, the load stops, and messages are purged only when this run published them. In a dry run
 * every mutation throws `DryRunRefusal`; reads go through as usual.
 */
export function createContext({ name, duration, dryRun }) {
  const started = Date.now();
  const checks = [];
  const cleanups = [];
  const publishedIds = new Set();

  const note = (text) => {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  [${name}] +${elapsed}s ${text}`);
  };
  const mutating = (action) => {
    if (dryRun) throw new DryRunRefusal(action);
  };
  const onCleanup = (label, undo) => cleanups.push({ label, undo });

  const load = createLoad({ note });

  const compose = {
    async stop(service) {
      mutating(`stop ${service}`);
      onCleanup(`start ${service}`, () => composeCli(["start", service]));
      note(`stop ${service}`);
      await composeCli(["stop", "--timeout", "30", service]);
    },
    async start(service) {
      mutating(`start ${service}`);
      note(`start ${service}`);
      await composeCli(["start", service]);
    },
    async restart(service) {
      mutating(`restart ${service}`);
      note(`restart ${service}`);
      await composeCli(["restart", "--timeout", "30", service]);
    },
    async pause(service) {
      mutating(`pause ${service}`);
      onCleanup(`unpause ${service}`, () => composeCli(["unpause", service]));
      note(`pause ${service}`);
      await composeCli(["pause", service]);
    },
    async unpause(service) {
      mutating(`unpause ${service}`);
      note(`unpause ${service}`);
      await composeCli(["unpause", service]);
    },
    async kill(service, signal = "SIGKILL") {
      mutating(`kill ${service}`);
      onCleanup(`start ${service}`, () => composeCli(["start", service]));
      note(`kill ${service} with ${signal}`);
      await composeCli(["kill", "-s", signal, service]);
    },
    ps: (service) => containerOf(service),
    waitHealthy: (service, timeoutMs = 120_000) => waitHealthy(service, timeoutMs),
  };

  const rabbitGuard = {
    queues: () => rabbit.queues(),
    queue: (queueName) => rabbit.queue(queueName),
    async publish(exchange, routingKey, payload, { messageId }) {
      mutating(`publish to ${exchange}`);
      publishedIds.add(messageId);
      return rabbit.publish(exchange, routingKey, payload, { messageId });
    },
    /** Empties `queue` of the messages this run published; anything else in it makes the purge refuse. */
    async purge(queueName) {
      mutating(`purge ${queueName}`);
      return rabbit.purge(queueName, { messageIds: [...publishedIds] });
    },
  };

  const ctx = {
    name,
    duration,
    dryRun,
    note,
    compose,
    rabbit: rabbitGuard,
    load: {
      start(options) {
        mutating("start the k6 load");
        load.start(options);
        onCleanup("stop the k6 load", () => load.stop());
      },
      stop: () => load.stop(),
      result: () => load.result(),
      /** Failed k6 requests (transport errors or 5xx) in the last `seconds`, from Prometheus. */
      errors: (seconds) => promScalar(`sum(increase(k6_chaos_http_errors_total[${Math.round(seconds)}s]))`),
      /** Requests the k6 load made in the last `seconds`, from Prometheus. */
      requests: (seconds) => promScalar(`sum(increase(k6_chaos_http_requests_total[${Math.round(seconds)}s]))`),
    },
    sql,
    sqlNumber,
    sqlJson,
    prom,
    promScalar,
    alerts,
    gateway: {
      anonymous: () => new GatewayClient({ readOnly: dryRun }),
      async login(account) {
        return new GatewayClient({ readOnly: dryRun }).login(ACCOUNTS[account] ?? account);
      },
    },
    async webhook(payload) {
      mutating("post a SePay webhook");
      return postSepayWebhook(payload);
    },
    sleep: (ms) => delay(ms),
    /** Polls `probe` until it returns a truthy value; throws with the label and the last value when time runs out. */
    async waitFor(label, probe, { timeoutMs = 120_000, intervalMs = 2_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let last;
      for (;;) {
        try {
          last = await probe();
          if (last) return last;
        } catch (error) {
          last = `error: ${error.message}`;
        }
        if (Date.now() >= deadline) {
          const shown = JSON.stringify(last)?.slice(0, 300);
          throw new Error(`${label} not reached within ${Math.round(timeoutMs / 1000)}s; last value: ${shown}`);
        }
        await delay(intervalMs);
      }
    },
    /** Records a PASS or FAIL without throwing, so the rest of the scenario still runs. */
    check(label, ok, detail = "") {
      const passed = Boolean(ok);
      checks.push({ label, passed, detail: String(detail).slice(0, 300) });
      note(`${passed ? "PASS" : "FAIL"} ${label}${detail ? ` (${String(detail).slice(0, 160)})` : ""}`);
      return passed;
    },
    /** Registers an undo for `restoreAll`. Use it for anything a scenario changes outside the helpers above. */
    onCleanup,
    /** Runs every registered undo, newest first. Each one is attempted even when an earlier one fails. */
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

  return { ctx, checks, restoreAll: () => ctx.restoreAll() };
}
