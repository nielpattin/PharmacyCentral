// Runs several SQL scripts against several databases in ONE psql session, so the demo backdating costs one round trip
// (one `docker compose exec` locally, one Fargate task on AWS) instead of one per statement.
//
// A step is { database, script }. The session switches databases with `\c`, and prints a marker before each step, so the
// output of every step can be told apart again (psql -At prints rows as `a|b|c`, one per line).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const marker = (index) => `@@STEP ${index}`;
const END = "@@END";

export const buildBatchScript = (steps) =>
  [
    ...steps.map(
      ({ database, script }, index) => `\\c ${database}\n\\echo ${marker(index)}\n${script.trim().replace(/;?$/, ";")}`,
    ),
    `\\echo ${END}`,
    "",
  ].join("\n");

/** Splits the psql output back into one string per step. Throws when the session did not reach its end. */
export const parseBatchOutput = (output, stepCount) => {
  const lines = output.replace(/\r/g, "").split("\n");
  const outputs = Array.from({ length: stepCount }, () => []);
  let current = -1;
  let ended = false;
  for (const line of lines) {
    if (line.trim() === END) {
      ended = true;
      break;
    }
    const match = /^@@STEP (\d+)$/.exec(line.trim());
    if (match) current = Number(match[1]);
    // psql announces every \c on stdout, even with -At; it is not a row of any step.
    else if (current >= 0 && !line.startsWith("You are now connected to")) outputs[current].push(line);
  }
  if (!ended) throw new Error("The SQL session ended before its last step. Output so far:\n" + output.slice(-2_000));
  return outputs.map((rows) => rows.join("\n"));
};

/** The compose Postgres of the local stack. */
export const localSqlRunner = ({ postgresUser }) => {
  return async (steps) => {
    const result = spawnSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        postgresUser,
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
      ],
      { cwd: repoRoot, input: buildBatchScript(steps), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.status !== 0)
      throw new Error(
        `Backdating needs the compose Postgres (docker compose exec postgres psql) and it failed: ` +
          `${result.stderr || result.error?.message || "no output"}`,
      );
    return parseBatchOutput(result.stdout, steps.length);
  };
};
