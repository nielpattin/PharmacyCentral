// Shared helpers for the verify-pharmacy-central scripts. Windows only: uses netstat, taskkill, and PowerShell.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(here, "../../../..");
export const VERIFY_ROOT = join(REPO_ROOT, ".tmp", "verify");
export const IDENTITY_DB = "identity_service";
export const DEMO_ADMIN_EMAIL = "admin@pharmacycentral.vn";

// Signed-in browser roles. Each role is a saved state file under the user's home directory (see roleStateFile).
export const BROWSER_ROLES = ["customer", "staff-admin", "staff-manager", "staff-pharmacist", "staff-warehouse"];
export const BROWSER_STATE_DIR = join(homedir(), ".omp", "browser-profiles");
export const roleStateFile = (role) => join(BROWSER_STATE_DIR, `${role}.json`);

// Named local URLs registered by `pnpm run urls:up` (portless proxy on 127.0.0.1:80). Keyed by Nx project name.
export const NAMED_WEB_URLS = {
  "customer-web": "http://customer.pharmacy.localhost",
  "staff-web": "http://staff.pharmacy.localhost",
};

process.loadEnvFile(join(REPO_ROOT, ".env"));

export const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key} in .env`);
  return value;
};

// `project` is the Nx project name from apps/<app>/package.json. `portKey` is the root .env variable.
export const TARGETS = [
  { name: "identity-service", kind: "service", project: "@pharmacy/identity-service", portKey: "IDENTITY_PORT" },
  {
    name: "catalog-service",
    kind: "service",
    project: "@pharmacy/catalog-service",
    portKey: "CATALOG_PORT",
    aiGated: true,
  },
  { name: "inventory-service", kind: "service", project: "@pharmacy/inventory-service", portKey: "INVENTORY_PORT" },
  { name: "sales-service", kind: "service", project: "@pharmacy/sales-service", portKey: "SALES_PORT" },
  { name: "payment-service", kind: "service", project: "@pharmacy/payment-service", portKey: "PAYMENT_PORT" },
  {
    name: "operations-query-service",
    kind: "service",
    project: "@pharmacy/operations-query-service",
    portKey: "OPERATIONS_QUERY_PORT",
  },
  {
    name: "chatbot-service",
    kind: "service",
    project: "@pharmacy/chatbot-service",
    portKey: "CHATBOT_PORT",
    aiGated: true,
  },
  { name: "customer-web", kind: "web", project: "@pharmacy/customer-web", portKey: "CUSTOMER_WEB_PORT" },
  { name: "staff-web", kind: "web", project: "@pharmacy/staff-web", portKey: "STAFF_WEB_PORT" },
];

export const targetByName = (name) => {
  const target = TARGETS.find((candidate) => candidate.name === name);
  if (!target) throw new Error(`Unknown target "${name}". Known: ${TARGETS.map((t) => t.name).join(", ")}`);
  return target;
};

export const portOf = (target) => Number(requireEnv(target.portKey));
export const gatewayUrl = () => `http://127.0.0.1:${requireEnv("GATEWAY_PORT")}`;
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export const httpGet = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { status: 0, body: "", error: error.cause?.code ?? error.message };
  }
};

// Reaches a named local URL through the portless proxy on 127.0.0.1:80 with a Host header. Node may not resolve
// *.localhost itself (docs/runbook.md, Named local URLs), so this does not depend on the resolver.
export const httpGetNamed = (host, path = "/") =>
  new Promise((done) => {
    const req = request(
      { host: "127.0.0.1", port: 80, path, method: "GET", headers: { host }, timeout: 4000 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length < 65536) body += chunk;
        });
        response.on("end", () => done({ status: response.statusCode, body }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => done({ status: 0, body: "", error: error.code ?? error.message }));
    req.end();
  });

export const healthOf = async (target) => {
  const port = portOf(target);
  if (target.kind === "service") {
    const response = await httpGet(`http://127.0.0.1:${port}/health/ready`);
    let service;
    try {
      service = JSON.parse(response.body).service;
    } catch {
      service = undefined;
    }
    const ok = response.status === 200 && service === target.name;
    return { ok, detail: `GET /health/ready -> ${response.status}${response.error ? ` ${response.error}` : ""}` };
  }
  const response = await httpGet(`http://127.0.0.1:${port}/`);
  const ok = response.status === 200 && response.body.includes('id="root"');
  return { ok, detail: `GET / -> ${response.status}${response.error ? ` ${response.error}` : ""}` };
};

const psRun = async (script) => {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  return stdout.trim();
};

export const listeningPids = async (port) => {
  const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "TCP"], { windowsHide: true });
  const pids = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[3] !== "LISTENING") continue;
    if (!columns[1].endsWith(`:${port}`)) continue;
    pids.add(Number(columns[4]));
  }
  return [...pids];
};

export const processInfo = async (pid) => {
  const out = await psRun(`
$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'
if ($null -eq $p) { 'null' } else {
  $startedAt = $null
  try { $startedAt = (Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToString('o') } catch {}
  [pscustomobject]@{ pid = $p.ProcessId; parent = $p.ParentProcessId; name = $p.Name; startedAt = $startedAt; commandLine = $p.CommandLine } | ConvertTo-Json -Compress
}`);
  return out === "" || out === "null" ? null : JSON.parse(out);
};

export const listProcesses = async () => {
  const out = await psRun(`
ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | ForEach-Object {
  [pscustomobject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; name = $_.Name; commandLine = $_.CommandLine }
})`);
  return JSON.parse(out || "[]");
};

const isAncestorRecorded = (pid, parentOf, recorded) => {
  let current = parentOf.get(pid);
  for (let depth = 0; current && depth < 32; depth += 1) {
    if (recorded.has(current)) return true;
    current = parentOf.get(current);
  }
  return false;
};

export const taskkill = async (pid, { force }) => {
  try {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

// "free" when nothing listens, "ours" when every listener descends from a recorded PID, else "foreign".
export const ownershipOf = async (pids, recorded) => {
  if (pids.length === 0) return "free";
  const parentOf = new Map((await listProcesses()).map((process) => [process.pid, process.parent]));
  const ours = pids.every((pid) => recorded.has(pid) || isAncestorRecorded(pid, parentOf, recorded));
  return ours ? "ours" : "foreign";
};

export const identityDb = async (fn) => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    host: "127.0.0.1",
    port: Number(requireEnv("POSTGRES_PORT")),
    user: requireEnv("POSTGRES_USER"),
    password: requireEnv("POSTGRES_PASSWORD"),
    database: IDENTITY_DB,
    connectionTimeoutMillis: 4000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

export const accountState = (email) =>
  identityDb(async (client) => {
    const { rows } = await client.query(
      `select u.id, u.actor_type, u.is_active,
              (select count(*)::int from sessions s
                 where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as active_sessions
         from users u where u.email = $1`,
      [email],
    );
    return rows[0] ?? null;
  });

export const newRunId = () => {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}-${randomBytes(2).toString("hex")}`;
};

export const runDir = (runId) => join(VERIFY_ROOT, runId);
const runFile = (runId) => join(runDir(runId), "run.json");
const pidFile = (runId) => join(runDir(runId), "pids.json");
const currentPointer = join(VERIFY_ROOT, "current");

export const currentRunId = () =>
  existsSync(currentPointer) ? readFileSync(currentPointer, "utf8").trim() : undefined;
export const setCurrentRun = (runId) => {
  mkdirSync(VERIFY_ROOT, { recursive: true });
  writeFileSync(currentPointer, `${runId}\n`);
};
export const runExists = (runId) => existsSync(runFile(runId));
export const readRun = (runId) => JSON.parse(readFileSync(runFile(runId), "utf8"));
export const writeRun = (runId, data) => writeFileSync(runFile(runId), `${JSON.stringify(data, null, 2)}\n`);
export const readPids = (runId) => (existsSync(pidFile(runId)) ? JSON.parse(readFileSync(pidFile(runId), "utf8")) : []);
export const writePids = (runId, records) => writeFileSync(pidFile(runId), `${JSON.stringify(records, null, 2)}\n`);

export const recordProcess = async (runId, label, pid) => {
  const info = await processInfo(pid);
  if (!info) throw new Error(`PID ${pid} (${label}) exited before it could be recorded`);
  const records = readPids(runId);
  records.push({ label, pid, startedAt: info.startedAt, name: info.name, commandLine: info.commandLine });
  writePids(runId, records);
};

export const spawnDev = (runId, projects) => {
  const logDir = join(runDir(runId), "logs");
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, "dev.log");
  const fd = openSync(log, "a");
  // Nx runs under node directly. A pnpm or cmd shim as the root exits early and orphans the tree it started.
  const nxBin = join(REPO_ROOT, "node_modules", "nx", "dist", "bin", "nx.js");
  const child = spawn(process.execPath, [nxBin, "run-many", "-t", "dev", "-p", ...projects], {
    cwd: REPO_ROOT,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    env: { ...process.env, NX_DAEMON: "false", NX_TUI: "false" },
  });
  return { child, log };
};

// Records every live descendant of the launch root, so a root that exits early cannot hide its children from stop.
export const recordDescendants = async (runId, rootPid) => {
  const children = new Map();
  for (const process of await listProcesses()) {
    children.set(process.parent, [...(children.get(process.parent) ?? []), process.pid]);
  }
  const found = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  const known = new Set(readPids(runId).map((record) => record.pid));
  for (const pid of found) {
    if (!known.has(pid)) await recordProcess(runId, "descendant", pid);
  }
};

// Kills what this run started: recorded PIDs (only if their start time still matches), their descendants, and
// listeners on the run's ports whose ancestry leads back to a recorded PID. Evidence and logs are never removed.
export const stopRun = async (runId) => {
  const run = readRun(runId);
  const records = readPids(runId);
  const report = { runId, processes: [], ports: [], stillListening: [] };

  for (const record of records) {
    const live = await processInfo(record.pid);
    if (!live) {
      report.processes.push({ ...record, action: "already-exited" });
    } else if (live.startedAt !== record.startedAt) {
      report.processes.push({ ...record, action: "pid-reused-skipped" });
    } else {
      const killed = await taskkill(record.pid, { force: true });
      report.processes.push({ ...record, action: killed ? "tree-killed" : "kill-failed" });
    }
  }

  const recorded = new Set(records.map((record) => record.pid));
  const snapshot = await listProcesses();
  const parentOf = new Map(snapshot.map((process) => [process.pid, process.parent]));
  for (const name of run.need ?? []) {
    const target = targetByName(name);
    const port = portOf(target);
    for (const pid of await listeningPids(port)) {
      if (isAncestorRecorded(pid, parentOf, recorded)) {
        const killed = await taskkill(pid, { force: true });
        report.ports.push({ name, port, pid, action: killed ? "tree-killed" : "kill-failed" });
      } else {
        const info = await processInfo(pid);
        report.ports.push({ name, port, pid, action: "foreign-left-alone", commandLine: info?.commandLine });
      }
    }
  }

  for (const name of run.need ?? []) {
    const target = targetByName(name);
    report.stillListening.push({ name, port: portOf(target), pids: await listeningPids(portOf(target)) });
  }
  return report;
};
