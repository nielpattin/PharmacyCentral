// Runs SQL against the private RDS instance by way of the one-shot `ops` ECS task (it has psql and the admin credentials).
//
// The script goes through the media bucket: the task command is limited to 8 KB, the script is not. The laptop uploads
// it, signs a short-lived URL, and the task pipes `wget URL` into psql. The output comes back from CloudWatch Logs.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { buildBatchScript, parseBatchOutput } from "./sql-batch.mjs";

const REGION = "us-east-1";
const PROFILE = "pharmacy";
const awsEnv = () => ({
  ...process.env,
  AWS_PROFILE: PROFILE,
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_ENDPOINT_URL_S3: "",
  AWS_ENDPOINT_URL: "",
  // The aws CLI is Python: without this it cannot print the box-drawing characters in task logs on a Windows console.
  PYTHONUTF8: "1",
});
export const aws = (args, options = {}) =>
  execFileSync("aws", ["--region", REGION, ...args], { encoding: "utf8", env: awsEnv(), ...options });
const sleep = (millis) => new Promise((resolve) => setTimeout(resolve, millis));

let terraformOutputs;
export const terraformOutput = () => {
  terraformOutputs ??= JSON.parse(
    execFileSync("terraform", ["-chdir=deploy/aws", "output", "-json"], { encoding: "utf8", env: awsEnv() }),
  );
  return terraformOutputs;
};

/**
 * Starts the ops task with `command`, waits for it to stop and returns its exit code and log text. The task is sized
 * 0.25 vCPU / 512 MiB so it fits next to the running stack in the 6 vCPU Fargate quota.
 */
export const runOpsTask = async ({ command, environment = [], label = "ops" }) => {
  const outputs = terraformOutput();
  const cluster = outputs.ecs_cluster_name.value;
  const subnets = outputs.private_subnet_ids.value.join(",");
  const securityGroup = outputs.ecs_tasks_security_group_id.value;
  const overrides = JSON.stringify({
    cpu: "256",
    memory: "512",
    containerOverrides: [{ name: "ops", cpu: 256, memory: 512, command, environment }],
  });
  const started = JSON.parse(
    aws([
      "ecs",
      "run-task",
      "--cluster",
      cluster,
      "--task-definition",
      outputs.ops_task_definition.value,
      "--launch-type",
      "FARGATE",
      "--network-configuration",
      `awsvpcConfiguration={subnets=[${subnets}],securityGroups=[${securityGroup}],assignPublicIp=DISABLED}`,
      "--overrides",
      overrides,
    ]),
  );
  if (started.failures?.length)
    throw new Error(`Could not start the ${label} task: ${JSON.stringify(started.failures)}`);
  const taskArn = started.tasks[0].taskArn;
  const taskId = taskArn.split("/").pop();
  aws(["ecs", "wait", "tasks-stopped", "--cluster", cluster, "--tasks", taskArn], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const described = JSON.parse(aws(["ecs", "describe-tasks", "--cluster", cluster, "--tasks", taskArn]));
  const container = described.tasks[0].containers[0];
  const exitCode = container.exitCode ?? -1;

  // CloudWatch needs a few seconds after the task stops before its last lines are readable.
  const logGroup = `/ecs/${outputs.ecs_cluster_name.value}/ops`;
  let text = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const events = JSON.parse(
        aws([
          "logs",
          "get-log-events",
          "--log-group-name",
          logGroup,
          "--log-stream-name",
          `ops/ops/${taskId}`,
          "--start-from-head",
          "--limit",
          "10000",
        ]),
      ).events;
      text = events.map((event) => event.message).join("\n");
      if (exitCode !== 0 || text.includes("@@END")) break;
    } catch {
      // The log stream does not exist yet.
    }
    await sleep(3_000);
  }
  return { exitCode, text, reason: container.reason };
};

/** The same runner interface as the local one: steps in, one output string per step out. */
export const awsSqlRunner = () => {
  const outputs = terraformOutput();
  const bucket = outputs.web.value.media_bucket;
  return async (steps) => {
    const key = `tmp/seed-sql-${randomUUID()}.sql`;
    aws(["s3", "cp", "-", `s3://${bucket}/${key}`], {
      input: buildBatchScript(steps),
      stdio: ["pipe", "ignore", "inherit"],
    });
    try {
      const url = aws(["s3", "presign", `s3://${bucket}/${key}`, "--expires-in", "900"]).trim();
      const { exitCode, text, reason } = await runOpsTask({
        label: "sql",
        command: [
          "bash",
          "-c",
          'set -o pipefail; wget -qO- "$SQL_URL" | psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -At',
        ],
        environment: [{ name: "SQL_URL", value: url }],
      });
      if (exitCode !== 0)
        throw new Error(`The SQL task failed (exit ${exitCode}${reason ? `, ${reason}` : ""}):\n${text.slice(-2_000)}`);
      return parseBatchOutput(text, steps.length);
    } finally {
      aws(["s3", "rm", `s3://${bucket}/${key}`], { stdio: "ignore" });
    }
  };
};
