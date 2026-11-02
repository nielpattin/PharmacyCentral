import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { exec, ROOT } from "./exec.mjs";

const SUMMARY_PREFIX = "CHAOS_SUMMARY ";
// k6 ends its run and prints the summary within seconds of SIGINT; past this grace period the container is killed.
const STOP_GRACE_MS = 60_000;

/**
 * The sustained checkout load: one `docker compose run` of the k6 service at a constant number of VUs. The container
 * gets a unique name, so stopping it can never touch a k6 run started by someone else. The summary line printed by
 * steady-checkout.js (`CHAOS_SUMMARY {...}`) is kept for the runner.
 */
export function createLoad({ note }) {
  let child = null;
  let containerName = null;
  let exited = null;
  let stopping = null;
  let summary;
  let stdoutBuffer = "";
  let stderrTail = "";

  const onStdoutLine = (line) => {
    if (line.startsWith(SUMMARY_PREFIX)) summary = JSON.parse(line.slice(SUMMARY_PREFIX.length));
  };

  async function stopLoad() {
    note("stopping the k6 load");
    // SIGINT makes k6 finish its run gracefully and print the summary before the container exits.
    await exec("docker", ["kill", "-s", "SIGINT", containerName]);
    const finished = await Promise.race([exited.then(() => true), delay(STOP_GRACE_MS).then(() => false)]);
    if (!finished) {
      note("k6 did not stop within the grace period: killing it");
      await exec("docker", ["kill", containerName]);
      child.kill();
    }
    const code = await exited;
    note(`k6 load stopped (exit ${code})`);
  }

  return {
    /** `rate` (journeys per second) selects the browse load; otherwise `vus` VUs run the checkout load. */
    start({ duration, vus, rate }) {
      if (child) throw new Error("the k6 load is already running");
      containerName = `chaos-k6-${process.pid}-${Date.now()}`;
      const args = [
        "compose",
        "--profile",
        "loadtest",
        "run",
        "--rm",
        "-T",
        "--name",
        containerName,
        "k6",
        "run",
        "--out",
        "experimental-prometheus-rw",
        ...(process.env.CHAOS_BASE_URL ? ["-e", `LOAD_TARGET_URL=${process.env.CHAOS_BASE_URL}`] : []),
        "-e",
        `CHAOS_DURATION=${duration}`,
        "-e",
        ...(rate === undefined ? [`CHAOS_VUS=${vus}`] : [`CHAOS_RATE=${rate}`]),
        rate === undefined ? "/scripts/chaos/steady-checkout.js" : "/scripts/chaos/steady-browse.js",
      ];
      child = spawn("docker", args, { cwd: ROOT, windowsHide: true });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk;
        let newline = stdoutBuffer.indexOf("\n");
        while (newline !== -1) {
          onStdoutLine(stdoutBuffer.slice(0, newline).trim());
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          newline = stdoutBuffer.indexOf("\n");
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderrTail = (stderrTail + chunk).slice(-4_000);
      });
      exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
      note(`k6 load started: ${rate === undefined ? `${vus} VUs` : `${rate} journeys/s`} for ${duration}s`);
    },

    /** Ends the load early. Idempotent; resolves once k6 has exited. */
    stop() {
      if (!child) return Promise.resolve();
      stopping ??= stopLoad();
      return stopping;
    },

    /** The exit code and k6 summary once the load has ended; undefined when it never started. */
    async result() {
      if (!child) return undefined;
      const exitCode = await exited;
      return { exitCode, summary, stderrTail };
    },
  };
}
