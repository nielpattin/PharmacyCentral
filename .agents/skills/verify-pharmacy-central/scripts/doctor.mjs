#!/usr/bin/env node
// Read-only check: is this local stack worth driving? Exits 0 when ready, 1 when any check fails, 2 on bad usage.
// Nothing is started, stopped, or written. Cookie values are never read or printed.
// Usage (repo root):
//   node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode dev [--need <a,b>] [--run <run-id>] [--role <role>] [--email <address>]
//   node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode container [--role <role>] [--email <address>]
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs, promisify } from "node:util";

import {
  accountState,
  BROWSER_ROLES,
  currentRunId,
  DEMO_ADMIN_EMAIL,
  gatewayUrl,
  healthOf,
  httpGet,
  httpGetNamed,
  listeningPids,
  NAMED_WEB_URLS,
  ownershipOf,
  portOf,
  processInfo,
  readPids,
  REPO_ROOT,
  roleStateFile,
  TARGETS,
  targetByName,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);

// One-shot init containers in docker-compose.yml that exit 0 by design (restart: "no").
const ONE_SHOT = new Set(["postgres-roles", "floci-init"]);
// Distroless images with no healthcheck in docker-compose.yml. They count as healthy while running.
const NO_HEALTHCHECK = new Set(["loki", "tempo"]);

const USAGE = `Usage (repo root):
  node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode dev [--need <a,b>] [--run <run-id>] [--role <role>] [--email <address>]
  node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode container [--role <role>] [--email <address>]
  --role one of: ${BROWSER_ROLES.join(", ")}`;

const usage = (message) => {
  console.error(`FAIL ${message}\n${USAGE}`);
  process.exit(2);
};

let values;
try {
  ({ values } = parseArgs({
    options: {
      mode: { type: "string" },
      need: { type: "string", default: "" },
      run: { type: "string" },
      role: { type: "string" },
      email: { type: "string" },
    },
  }));
} catch (error) {
  usage(error.message);
}

if (!values.mode) {
  usage("--mode is required: dev (apps on the host, pnpm run infra:up + pnpm dev) or container (pnpm run stack:up)");
}
if (values.mode !== "dev" && values.mode !== "container")
  usage(`--mode must be dev or container, got "${values.mode}"`);
if (values.role && !BROWSER_ROLES.includes(values.role)) usage(`--role must be one of ${BROWSER_ROLES.join(", ")}`);
if (values.mode === "container" && values.need)
  usage("--need applies to dev mode only; container mode checks the containers");
if (values.mode === "container" && values.run) usage("--run applies to dev mode only");

let failures = 0;
const line = (level, label, detail) => {
  if (level === "FAIL") failures += 1;
  console.log(`${level.padEnd(4)} ${label.padEnd(26)} ${detail}`);
};

const accountCheck = async (email) => {
  try {
    const account = await accountState(email);
    if (account) {
      line(
        "OK",
        "identity db + account",
        `${email} actor=${account.actor_type} active=${account.is_active} activeSessions=${account.active_sessions}`,
      );
    } else {
      line(
        "FAIL",
        "identity db + account",
        `no users row for ${email}. Run pnpm run db:migrate, pnpm run seed:default and pnpm run seed:demo`,
      );
    }
  } catch (error) {
    line("FAIL", "identity db", `${error.message}. Is postgres healthy?`);
  }
};

// A saved state file is the signed-in role. Only its JSON validity is checked here; the drive confirms the session
// with GET /api/auth/me. A missing file is not a failure: the drive signs in and saves it.
const roleCheck = (role) => {
  const file = roleStateFile(role);
  const label = `browser state ${role}`;
  if (!existsSync(file)) {
    line("INFO", label, `${file} missing. Sign in on a clean tab and tab.saveState(...) to create it`);
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
    line("OK", label, `${file} is valid JSON`);
  } catch (error) {
    line("FAIL", label, `${file} is not a valid state file (${error.message}). Delete it and sign in again`);
  }
};

const parseComposePs = (text) => {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  // Older Compose releases print one JSON object per line.
  return trimmed
    .split(/\r?\n/)
    .filter(Boolean)
    .map((row) => JSON.parse(row));
};

const compose = async (args) => {
  const { stdout } = await execFileAsync("docker", ["compose", ...args], {
    cwd: REPO_ROOT,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
};

const containerChecks = async () => {
  let services;
  let containers;
  try {
    services = (await compose(["config", "--services"]))
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    containers = parseComposePs(await compose(["ps", "--all", "--format", "json"]));
  } catch (error) {
    line(
      "FAIL",
      "docker compose",
      `${(error.stderr || error.message).trim().split(/\r?\n/)[0]}. Is Docker Desktop running?`,
    );
    return;
  }

  const byService = new Map(containers.map((container) => [container.Service, container]));
  const problems = [];
  for (const service of services) {
    const container = byService.get(service);
    if (!container) {
      problems.push(`${service}: not created. Run pnpm run stack:up`);
      continue;
    }
    const state = container.State ?? "";
    const health = container.Health ?? "";
    if (ONE_SHOT.has(service)) {
      if (!(state === "exited" && Number(container.ExitCode) === 0)) {
        problems.push(`${service}: state=${state} exit=${container.ExitCode}. Expected exited 0 (one-shot init)`);
      }
    } else if (NO_HEALTHCHECK.has(service)) {
      if (!(state === "running" && (health === "" || health === "healthy"))) {
        problems.push(`${service}: state=${state} health=${health || "none"}. Expected running`);
      }
    } else if (!(state === "running" && health === "healthy")) {
      problems.push(`${service}: state=${state} health=${health || "none"}. Expected running and healthy`);
    }
  }
  for (const container of containers) {
    if (!services.includes(container.Service) && container.State === "running") {
      problems.push(
        `${container.Service}: running but not part of the stack (dev profile?). Stop it: docker compose stop ${container.Service}`,
      );
    }
  }

  if (problems.length === 0) {
    line("OK", "containers", `${services.length}/${services.length} services running and healthy`);
  } else {
    for (const problem of problems) line("FAIL", "container", problem);
  }
};

const containerMode = async () => {
  const gateway = await httpGet(`${gatewayUrl()}/healthz`);
  if (gateway.status === 200) {
    line("OK", "gateway", `${gatewayUrl()} /healthz 200`);
  } else {
    line("FAIL", "gateway", `${gatewayUrl()} /healthz ${gateway.status} ${gateway.error ?? ""}. Run pnpm run stack:up`);
  }

  await containerChecks();

  for (const [project, url] of Object.entries(NAMED_WEB_URLS)) {
    const response = await httpGetNamed(new URL(url).hostname, "/");
    if (response.status === 200) {
      line("OK", `url ${project}`, `${url}/ 200 (via 127.0.0.1:80)`);
    } else {
      line(
        "FAIL",
        `url ${project}`,
        `${url}/ ${response.status} ${response.error ?? ""}. Run pnpm run urls:up (once per session; port 80 must be free)`,
      );
    }
  }

  if (values.email) await accountCheck(values.email);
};

const devMode = async () => {
  const need = values.need
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  try {
    need.forEach(targetByName);
  } catch (error) {
    usage(error.message);
  }

  const runId = values.run ?? currentRunId();
  const recorded = new Set(runId ? readPids(runId).map((record) => record.pid) : []);

  const gateway = await httpGet(`${gatewayUrl()}/healthz`);
  if (gateway.status === 200) {
    line("OK", "gateway-dev", `${gatewayUrl()} /healthz 200`);
  } else {
    line(
      "FAIL",
      "gateway-dev",
      `${gatewayUrl()} /healthz ${gateway.status} ${gateway.error ?? ""}. Run pnpm run infra:up. On Docker Desktop, host networking must be on.`,
    );
  }

  await accountCheck(values.email ?? DEMO_ADMIN_EMAIL);

  let identityAnswers = false;
  for (const target of TARGETS) {
    const wanted = need.includes(target.name);
    const port = portOf(target);
    const owners = await listeningPids(port);
    const ownership = await ownershipOf(owners, recorded);
    const health = await healthOf(target);
    const label = `${target.name} :${port}`;
    const owner = owners.length ? await processInfo(owners[0]) : null;
    if (target.name === "identity-service") identityAnswers = health.ok;

    if (ownership === "free") {
      if (wanted) line("FAIL", label, "not running. Launch it with scripts/launch.mjs");
      else if (health.ok) line("WARN", label, `answers (${health.detail}) with no listener PID`);
      else line("INFO", label, "stopped");
    } else if (ownership === "ours") {
      if (health.ok) line("OK", label, `started by run ${runId}; ${health.detail}`);
      else line("FAIL", label, `started by run ${runId} but not ready; ${health.detail}`);
    } else {
      const detail = `owned by PID ${owners.join(",")} (${owner?.name ?? "unknown"}), not this run`;
      if (wanted) line("FAIL", label, `${detail}. Refusing to drive it`);
      else line("WARN", label, `${detail}. Not used by this run`);
    }
  }

  if (identityAnswers) {
    const csrf = await httpGet(`${gatewayUrl()}/api/auth/csrf`);
    if (csrf.status === 200 && csrf.body.includes("csrfToken")) {
      line("OK", "gateway -> identity", "GET /api/auth/csrf 200");
    } else {
      line("FAIL", "gateway -> identity", `GET /api/auth/csrf ${csrf.status}. Gateway cannot reach identity-service`);
    }
  }
};

if (values.mode === "dev") await devMode();
else await containerMode();

if (values.role) roleCheck(values.role);

console.log(failures === 0 ? "RESULT ready (0 failures)" : `RESULT not ready (${failures} failure(s))`);
process.exitCode = failures === 0 ? 0 : 1;
