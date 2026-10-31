import { execFileSync } from "node:child_process";

const tfOut = JSON.parse(execFileSync("node", ["tools/aws-tf.mjs", "output", "-json"], { encoding: "utf8" }));
const cluster = tfOut.ecs_cluster_name.value;
const subnets = tfOut.private_subnet_ids.value;
const sgs = [tfOut.ecs_tasks_security_group_id.value];
const opsDef = tfOut.ops_task_definition.value;

const overrides = JSON.stringify({
  containerOverrides: [
    {
      name: "ops",
      command: ["node", "/ops/seed-demo.mjs"],
    },
  ],
});

const netConfig = `awsvpcConfiguration={subnets=[${subnets.join(",")}],securityGroups=[${sgs.join(",")}],assignPublicIp=DISABLED}`;

console.log("Starting ops seed-demo task...");
const out = JSON.parse(
  execFileSync(
    "aws",
    [
      "--profile",
      "pharmacy",
      "--region",
      "us-east-1",
      "ecs",
      "run-task",
      "--cluster",
      cluster,
      "--task-definition",
      opsDef,
      "--launch-type",
      "FARGATE",
      "--network-configuration",
      netConfig,
      "--overrides",
      overrides,
    ],
    { encoding: "utf8" },
  ),
);

const taskArn = out.tasks[0].taskArn;
console.log(`Task started: ${taskArn}. Waiting...`);

execFileSync(
  "aws",
  [
    "--profile",
    "pharmacy",
    "--region",
    "us-east-1",
    "ecs",
    "wait",
    "tasks-stopped",
    "--cluster",
    cluster,
    "--tasks",
    taskArn,
  ],
  { stdio: "inherit" },
);

const desc = JSON.parse(
  execFileSync(
    "aws",
    [
      "--profile",
      "pharmacy",
      "--region",
      "us-east-1",
      "ecs",
      "describe-tasks",
      "--cluster",
      cluster,
      "--tasks",
      taskArn,
    ],
    { encoding: "utf8" },
  ),
);

const container = desc.tasks[0].containers[0];
console.log(`Task finished with exit code: ${container.exitCode}`);
if (container.exitCode !== 0) {
  process.exit(1);
}
