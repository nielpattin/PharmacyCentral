#!/usr/bin/env node
// DEV MODE ONLY. Starts only the Nx dev targets a feature needs, waits until they are usable, and records every PID it
// started. Container mode (pnpm run aws) is never launched here: check it with doctor.mjs --mode container.
// Usage (repo root):
//   node .agents/skills/verify-pharmacy-central/scripts/launch.mjs --need identity-service,staff-web [--run <id>] [--ai-approved]
// Add --ai-approved only with the user's explicit approval for that run (catalog-service and chatbot-service call paid AI).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  accountState,
  DEMO_ADMIN_EMAIL,
  gatewayUrl,
  healthOf,
  httpGet,
  identityDb,
  listeningPids,
  NAMED_WEB_URLS,
  newRunId,
  portOf,
  readPids,
  recordProcess,
  recordDescendants,
  runDir,
  runExists,
  setCurrentRun,
  sleep,
  spawnDev,
  stopRun,
  targetByName,
  writePids,
  writeRun,
} from "./lib.mjs";

const READY_TIMEOUT_MS = 240_000;
const USAGE = `Usage (repo root, dev mode only):
  node .agents/skills/verify-pharmacy-central/scripts/launch.mjs --need <name[,name...]> [--run <id>] [--ai-approved]`;

const fail = (message) => {
  console.error(`FAIL ${message}`);
  process.exit(1);
};

let values;
try {
  ({ values } = parseArgs({
    options: {
      need: { type: "string" },
      run: { type: "string" },
      "ai-approved": { type: "boolean", default: false },
    },
  }));
} catch (error) {
  console.error(`FAIL ${error.message}\n${USAGE}`);
  process.exit(2);
}

if (!values.need) fail(`--need is required, for example --need identity-service,staff-web\n${USAGE}`);
const need = values.need
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
let targets;
try {
  targets = need.map(targetByName);
} catch (error) {
  console.error(`FAIL ${error.message}\n${USAGE}`);
  process.exit(2);
}
const projects = targets.map((target) => target.project);

const aiGated = targets.filter((target) => target.aiGated);
if (aiGated.length > 0 && !values["ai-approved"]) {
  fail(
    `${aiGated.map((t) => t.name).join(", ")} can call a paid AI provider at startup. Only with the user's explicit approval for that run: rerun with --ai-approved`,
  );
}

// Preflight: nothing started yet, so every failure here is safe to exit on.
const gateway = await httpGet(`${gatewayUrl()}/healthz`);
if (gateway.status !== 200) fail(`gateway-dev is not answering on ${gatewayUrl()}. Run pnpm run dev:infra first`);
if (need.includes("identity-service")) {
  await identityDb((client) => client.query("select 1")).catch((error) =>
    fail(`identity database unreachable: ${error.message}`),
  );
  const admin = await accountState(DEMO_ADMIN_EMAIL).catch((error) => fail(error.message));
  if (!admin) fail("the default admin is missing. Run pnpm run db:migrate and pnpm run seed:default");
}
for (const target of targets) {
  const owners = await listeningPids(portOf(target));
  if (owners.length > 0) {
    fail(
      `${target.name} port ${portOf(target)} is held by PID ${owners.join(",")}. Not started by this skill, refusing. ` +
        "If the stack runs in Docker (container mode), stop it or check it with doctor.mjs --mode container instead of launching",
    );
  }
}

const runId = values.run ?? newRunId();
if (runExists(runId)) fail(`run ${runId} already exists. Pick a new --run id`);

mkdirSync(join(runDir(runId), "logs"), { recursive: true });
writeRun(runId, {
  runId,
  startedAt: new Date().toISOString(),
  need,
  projects,
  gateway: gatewayUrl(),
  aiApproved: Boolean(values["ai-approved"]),
});
writePids(runId, []);
setCurrentRun(runId);

const { child, log } = spawnDev(runId, projects);
await recordProcess(runId, "nx-root", child.pid);
console.log(`START run ${runId}: nx run-many -t dev -p ${projects.join(" ")}`);
console.log(`LOG   ${log}`);

const identityNeeded = need.includes("identity-service");
const statusLine = async () => {
  const parts = [];
  let ready = true;
  for (const target of targets) {
    const health = await healthOf(target);
    parts.push(`${target.name}=${health.ok ? "ok" : "wait"}`);
    if (!health.ok) ready = false;
  }
  if (ready && identityNeeded) {
    const me = await httpGet(`${gatewayUrl()}/api/auth/me`);
    const routed = me.status === 401;
    parts.push(`gateway->identity=${routed ? "ok" : "wait"}`);
    if (!routed) ready = false;
  }
  return { ready, text: parts.join(" ") };
};

const deadline = Date.now() + READY_TIMEOUT_MS;
let last = "";
let ready = false;
while (Date.now() < deadline) {
  if (child.exitCode !== null) break;
  const status = await statusLine();
  if (status.text !== last) {
    console.log(`WAIT  ${status.text}`);
    last = status.text;
  }
  if (status.ready) {
    ready = true;
    break;
  }
  await sleep(2000);
}

if (!ready) {
  const tail = existsSync(log) ? readFileSync(log, "utf8").split(/\r?\n/).slice(-40).join("\n") : "(no log)";
  console.error(`FAIL not ready within ${READY_TIMEOUT_MS / 1000}s (nx exit code: ${child.exitCode ?? "running"})`);
  console.error(tail);
  await recordDescendants(runId, child.pid);
  const report = await stopRun(runId);
  console.error(`CLEANUP ${JSON.stringify(report.processes.map((p) => `${p.label}:${p.pid}:${p.action}`))}`);
  process.exit(1);
}

await recordDescendants(runId, child.pid);
for (const target of targets) {
  for (const pid of await listeningPids(portOf(target))) {
    if (!readPids(runId).some((record) => record.pid === pid)) {
      await recordProcess(runId, `listener:${target.name}`, pid);
    }
  }
}
child.unref();
console.log(`READY run ${runId}`);
for (const target of targets) {
  // Web apps are driven through their named URL (needs pnpm run urls:up); services are checked on their health route.
  const url =
    target.kind === "web" && NAMED_WEB_URLS[target.name]
      ? `${NAMED_WEB_URLS[target.name]}/`
      : `http://localhost:${portOf(target)}/health/ready`;
  console.log(`URL   ${target.name} ${url}`);
}
console.log(`PIDS  see .tmp/verify/${runId}/pids.json`);
console.log(`STOP  node .agents/skills/verify-pharmacy-central/scripts/stop.mjs --run ${runId}`);
