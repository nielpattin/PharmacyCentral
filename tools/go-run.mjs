import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Dev runner for the search-service Go module (the `dev` target of apps/search-service/project.json).
 *
 * It builds the service into the OS temp directory and runs that binary. When a .go file under cmd/
 * or internal/ changes, it stops the service, rebuilds and restarts it. A failed build leaves the
 * runner waiting for the next change. Ctrl+C or SIGTERM stops the service, removes the temp binary
 * and exits 0.
 *
 * Runs from the project root (process.cwd()), so the relative paths below are resolved from there.
 */

const isWindows = process.platform === "win32";
const watchedDirs = ["cmd", "internal"];
const debounceMs = 200;
const killGraceMs = 5000;
const goMissing = "Go toolchain not found: install Go 1.26 or newer (`go` is not on PATH).";
const binPath = path.join(os.tmpdir(), isWindows ? "search-service-dev.exe" : "search-service-dev");

let current = null;
let debounce = null;
let queue = Promise.resolve();
let shuttingDown = false;

function removeBinary() {
  try {
    fs.rmSync(binPath, { force: true });
  } catch (error) {
    console.error(`Could not remove ${binPath}: ${error.message}`);
  }
}

function fail(message) {
  console.error(message);
  removeBinary();
  process.exit(1);
}

function build() {
  return new Promise((resolve) => {
    const proc = spawn("go", ["build", "-o", binPath, "./cmd/search-service"], { stdio: "inherit" });
    proc.once("error", (error) => {
      if (error.code === "ENOENT") fail(goMissing);
      console.error(error.message);
      resolve(false);
    });
    proc.once("exit", (code) => resolve(code === 0));
  });
}

function start() {
  const proc = spawn(binPath, [], { stdio: "inherit" });
  current = proc;
  proc.once("error", (error) => {
    if (current === proc) current = null;
    console.error(`Could not start ${binPath}: ${error.message}`);
  });
  proc.once("exit", (code, signal) => {
    if (current !== proc) return; // stopped on purpose by stopChild()
    current = null;
    console.error(`search-service exited (${signal ?? `code ${code}`}); waiting for the next change.`);
  });
}

function stopChild() {
  const proc = current;
  current = null;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    proc.once("exit", resolve);
    if (isWindows) {
      // Windows has no SIGTERM for console processes: taskkill ends the whole tree.
      spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
      proc.kill();
      return;
    }
    proc.kill("SIGTERM");
    const forceTimer = setTimeout(() => proc.kill("SIGKILL"), killGraceMs);
    proc.once("exit", () => clearTimeout(forceTimer));
  });
}

async function restart(reason) {
  if (shuttingDown) return;
  console.log(reason);
  await stopChild();
  if (shuttingDown) return;
  if (!(await build())) {
    console.error("Build failed; waiting for the next change.");
    return;
  }
  if (!shuttingDown) start();
}

function enqueue(reason) {
  queue = queue.then(() => restart(reason)).catch((error) => console.error(error));
}

const watchers = watchedDirs.map((dir) =>
  fs.watch(dir, { recursive: true }, (_event, filename) => {
    if (filename !== null && !filename.endsWith(".go")) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => enqueue("Change detected; rebuilding search-service..."), debounceMs);
  }),
);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(debounce);
  for (const watcher of watchers) watcher.close();
  await queue;
  await stopChild();
  removeBinary();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown());
}

enqueue("Starting search-service...");
