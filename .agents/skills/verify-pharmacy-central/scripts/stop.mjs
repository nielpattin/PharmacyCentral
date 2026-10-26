#!/usr/bin/env node
// DEV MODE ONLY. Stops exactly what a launch.mjs run started and keeps its evidence. Writes cleanup.json into the run
// directory. Container mode is never stopped by this skill.
// Usage (repo root):
//   node .agents/skills/verify-pharmacy-central/scripts/stop.mjs [--run <run-id>]
// Defaults to the run named in .tmp/verify/current.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { currentRunId, runDir, runExists, stopRun } from "./lib.mjs";

const USAGE = `Usage (repo root, dev mode only):
  node .agents/skills/verify-pharmacy-central/scripts/stop.mjs [--run <run-id>]`;

let values;
try {
  ({ values } = parseArgs({ options: { run: { type: "string" } } }));
} catch (error) {
  console.error(`FAIL ${error.message}\n${USAGE}`);
  process.exit(2);
}

const runId = values.run ?? currentRunId();
if (!runId) {
  console.error(`FAIL no run id given and no current run\n${USAGE}`);
  process.exit(1);
}
if (!runExists(runId)) {
  console.error(`FAIL run ${runId} not found under .tmp/verify/`);
  process.exit(1);
}

const report = await stopRun(runId);
writeFileSync(join(runDir(runId), "cleanup.json"), `${JSON.stringify(report, null, 2)}\n`);

for (const processRecord of report.processes) {
  console.log(`PROC  ${processRecord.label.padEnd(28)} pid=${processRecord.pid} ${processRecord.action}`);
}
for (const portRecord of report.ports) {
  console.log(`PORT  ${portRecord.name} :${portRecord.port} pid=${portRecord.pid ?? "-"} ${portRecord.action ?? ""}`);
}
for (const listening of report.stillListening) {
  console.log(`CHECK ${listening.name} :${listening.port} listeners=${listening.pids.join(",") || "none"}`);
}
console.log(`KEPT  evidence and logs in .tmp/verify/${runId}/`);

const unresolved =
  report.processes.some((record) => record.action === "kill-failed") ||
  report.ports.some((record) => record.action === "foreign-left-alone" || record.action === "kill-failed") ||
  report.stillListening.some((listening) => listening.pids.length > 0);
process.exitCode = unresolved ? 1 : 0;
