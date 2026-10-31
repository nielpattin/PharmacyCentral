import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Run a task on AWS ECS and wait for completion
function runTask(cluster, taskDef, containerName, command, subnets, sgs) {
  const overrides = command
    ? JSON.stringify({
        containerOverrides: [
          {
            name: containerName,
            command,
          },
        ],
      })
    : "{}";

  const netConfig = `awsvpcConfiguration={subnets=[${subnets.join(",")}],securityGroups=[${sgs.join(",")}],assignPublicIp=DISABLED}`;

  console.log(`Starting task ${containerName} (${command ? command.join(" ") : "default"})...`);
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
        taskDef,
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

  if (out.failures && out.failures.length > 0) {
    throw new Error(`Failed to run task: ${JSON.stringify(out.failures)}`);
  }

  const taskArn = out.tasks[0].taskArn;
  console.log(`Task started: ${taskArn}. Waiting for completion...`);

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
  console.log(`Task ${containerName} finished with exit code ${container.exitCode}`);
  if (container.exitCode !== 0) {
    throw new Error(
      `Task ${containerName} failed with exit code ${container.exitCode}: ${container.reason || "unknown"}`,
    );
  }
}

async function main() {
  const tfOut = JSON.parse(execFileSync("node", ["tools/aws-tf.mjs", "output", "-json"], { encoding: "utf8" }));
  const cluster = tfOut.ecs_cluster_name.value;
  const subnets = tfOut.private_subnet_ids.value;
  const sgs = [tfOut.ecs_tasks_security_group_id.value];
  const opsDef = tfOut.ops_task_definition.value;
  const migrations = tfOut.migration_task_definitions.value;

  console.log("=== Step 1: Database creation & roles ===");
  runTask(
    cluster,
    opsDef,
    "ops",
    [
      "bash",
      "-c",
      'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -f /ops/001-create-databases.sql && bash /ops/roles.sh',
    ],
    subnets,
    sgs,
  );

  console.log("=== Step 2: Database migrations ===");
  for (const [svc, taskDef] of Object.entries(migrations)) {
    console.log(`Migrating ${svc}...`);
    runTask(cluster, taskDef, svc, null, subnets, sgs);
  }

  console.log("=== Step 3: Default seed (Platform Admin) ===");
  runTask(cluster, opsDef, "ops", ["node", "/ops/seed.mjs"], subnets, sgs);

  console.log("=== Step 4: Demo seed (accounts) ===");
  runTask(cluster, opsDef, "ops", ["node", "/ops/seed-demo.mjs"], subnets, sgs);

  console.log("All migrations and seeds completed successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
