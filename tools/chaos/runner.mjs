#!/usr/bin/env node
// Chaos runner: a sustained checkout load in the background, one injected fault per scenario, then recovery and data
// invariants. Usage: pnpm run chaos <scenario|all> [--duration 240] [--dry-run]
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createContext } from "./lib/context.mjs";
import { requiredEnv } from "./lib/env.mjs";

const SCENARIO_DIR = join(dirname(fileURLToPath(import.meta.url)), "scenarios");
const REQUIRED_ENV = [
  "POSTGRES_USER",
  "RABBITMQ_USER",
  "RABBITMQ_PASSWORD",
  "RABBITMQ_MANAGEMENT_PORT",
  "GRAFANA_PORT",
  "GRAFANA_ADMIN_USER",
  "GRAFANA_ADMIN_PASSWORD",
  "GATEWAY_PORT",
  "DEMO_ACCOUNT_PASSWORD",
  "SEPAY_WEBHOOK_SECRET",
];
const USAGE = "usage: pnpm run chaos <scenario|all> [--duration <seconds>=240] [--dry-run]";
const MIN_DURATION_S = 60;

function parseArgs(argv) {
  const options = { scenario: undefined, duration: 240, dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--duration") options.duration = Number(argv[++index]);
    else if (arg.startsWith("--duration=")) options.duration = Number(arg.slice("--duration=".length));
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}\n${USAGE}`);
    else if (options.scenario === undefined) options.scenario = arg;
    else throw new Error(`Unexpected argument ${arg}\n${USAGE}`);
  }
  if (options.scenario === undefined) throw new Error(USAGE);
  if (!Number.isInteger(options.duration) || options.duration < MIN_DURATION_S) {
    throw new Error(`--duration must be a whole number of seconds, at least ${MIN_DURATION_S}`);
  }
  return options;
}

async function loadScenarios() {
  const files = (await readdir(SCENARIO_DIR)).filter((file) => file.endsWith(".mjs")).sort();
  const scenarios = [];
  for (const file of files) {
    const module = await import(pathToFileURL(join(SCENARIO_DIR, file)).href);
    const scenario = module.default;
    if (
      typeof scenario?.name !== "string" ||
      typeof scenario.description !== "string" ||
      typeof scenario.run !== "function"
    ) {
      throw new Error(`scenarios/${file} must default-export { name, description, run }`);
    }
    scenarios.push(scenario);
  }
  return scenarios;
}

function describeLoad(load) {
  if (!load.summary) return `k6 exit ${load.exitCode}, no summary: ${load.stderrTail.trim().slice(-300)}`;
  const s = load.summary;
  const failedPct = s.httpRequests > 0 ? ((s.httpFailed / s.httpRequests) * 100).toFixed(2) : "0.00";
  return `k6 exit ${load.exitCode}: ${s.iterations} iterations, ${s.httpRequests} requests, ${s.httpFailed} failed (${failedPct}%), ${s.businessRejections} business refusals`;
}

function printResult(result) {
  const passed = result.checks.filter((check) => check.passed).length;
  const verdict = result.error || passed !== result.checks.length ? "FAIL" : "PASS";
  console.log(`\n${result.name}: ${verdict} (${passed}/${result.checks.length} checks passed)`);
  if (result.load) console.log(`  load: ${describeLoad(result.load)}`);
  for (const check of result.checks) {
    console.log(`  ${check.passed ? "PASS" : "FAIL"}  ${check.label}${check.detail ? `  -- ${check.detail}` : ""}`);
  }
  if (result.error) console.log(`  FAIL  scenario threw: ${result.error.message}`);
  return verdict === "PASS";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const name of REQUIRED_ENV) requiredEnv(name);

  const scenarios = await loadScenarios();
  const selected =
    options.scenario === "all" ? scenarios : scenarios.filter((scenario) => scenario.name === options.scenario);
  if (selected.length === 0) {
    const names = scenarios.map((scenario) => scenario.name).join(", ");
    throw new Error(`Unknown scenario "${options.scenario}". Available: all, ${names}`);
  }

  let current;
  let interrupted = false;
  const onSignal = (signal) => {
    if (interrupted) return;
    interrupted = true;
    console.error(`\nReceived ${signal}: restoring the stack before exit`);
    (current?.restoreAll() ?? Promise.resolve()).finally(() => process.exit(130));
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  const results = [];
  for (const scenario of selected) {
    const { ctx, checks, restoreAll } = createContext({
      name: scenario.name,
      duration: options.duration,
      dryRun: options.dryRun,
    });
    current = { restoreAll };
    console.log(`\n=== ${scenario.name}: ${scenario.description}`);
    if (options.dryRun) for (const step of scenario.plan ?? []) console.log(`  plan: ${step}`);

    let error;
    try {
      if (options.dryRun) await scenario.preflight?.(ctx);
      else await scenario.run(ctx);
    } catch (caught) {
      error = caught;
    } finally {
      await restoreAll();
      current = undefined;
    }

    const load = await ctx.load.result();
    if (load && (!load.summary || load.summary.iterations === 0)) {
      checks.push({
        label: "k6 load ran checkout iterations",
        passed: false,
        detail: load.summary
          ? `no iteration ran (k6 exit ${load.exitCode}): setup failed`
          : load.stderrTail.trim().slice(-200),
      });
    }
    results.push({ name: scenario.name, checks, error, load });
  }

  const allPassed = results.map(printResult).every(Boolean);
  process.exitCode = allPassed ? 0 : 1;
}

main().catch((error) => {
  console.error(`chaos runner: ${error.message}`);
  process.exitCode = 1;
});
