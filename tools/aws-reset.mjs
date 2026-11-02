// Wipes the data of the AWS stack and loads it again, so the dataset is clean and dated today. Usage:
//   node tools/aws-reset.mjs [--yes] [--tag <imageTag>]
// It is destructive on purpose: the seven service databases are dropped and recreated, and the message broker and the search
// index start empty. Without --yes it asks you to type `reset`. The tag defaults to the latest git tag (the version
// that is deployed). Steps:
//   1. scale the database-owning services to zero, so nothing holds a connection;
//   2. restart RabbitMQ and Typesense, so no stale event or index entry survives;
//   3. drop and recreate the databases, roles and tables (ops task: psql, then tools/aws-migrate.mjs);
//   4. bring the services back with terraform apply, then load the data (tools/aws-seed.mjs).
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

import { aws, runOpsTask } from "./lib/aws-ops.mjs";

const args = process.argv.slice(2);
const tagIndex = args.indexOf("--tag");
const tag =
  tagIndex >= 0
    ? args[tagIndex + 1]
    : execFileSync("git", ["describe", "--tags", "--abbrev=0"], { encoding: "utf8" }).trim();
const cluster = "pharmacy-central-staging";
const databaseServices = [
  "identity-service",
  "catalog-service",
  "inventory-service",
  "sales-service",
  "payment-service",
  "operations-query-service",
  "chatbot-service",
];
const databases = databaseServices.map((service) => service.replaceAll("-", "_"));
const step = (title) => console.log(`\n=== ${title} ===`);
const node = (...a) => execFileSync("node", a, { stdio: "inherit" });
const names = (services) => services.map((service) => `${cluster}-${service}`);
const stable = (services) =>
  aws(["ecs", "wait", "services-stable", "--cluster", cluster, "--services", ...names(services)]);

if (!args.includes("--yes")) {
  if (!process.stdin.isTTY) {
    console.error("There is no terminal to ask for confirmation. Run it again with --yes: pnpm run cloud:reset --yes");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "This deletes ALL data in the AWS stack (databases, queued events, search index) and loads it again. Type 'reset' to continue: ",
  );
  rl.close();
  if (answer.trim() !== "reset") {
    console.log("Aborted.");
    process.exit(1);
  }
}
console.log(`image tag: ${tag}`);

step("1/4 Stop the services that use the databases");
for (const service of names(databaseServices))
  aws(["ecs", "update-service", "--cluster", cluster, "--service", service, "--desired-count", "0"], {
    stdio: "ignore",
  });
stable(databaseServices);

step("2/4 Restart RabbitMQ and Typesense (they start empty)");
for (const service of names(["rabbitmq", "typesense"]))
  aws(["ecs", "update-service", "--cluster", cluster, "--service", service, "--force-new-deployment"], {
    stdio: "ignore",
  });
stable(["rabbitmq", "typesense"]);

step("3/4 Recreate the databases");
// One -c per statement: DROP DATABASE cannot run inside the implicit transaction of a multi-statement string.
// Each database is owned by its service role, and the RDS admin is not a superuser: it must be a member of the owning role
// to drop the database.
const drop = [
  ...databases.map((database) => `GRANT ${database} TO CURRENT_USER`),
  ...databases.map((database) => `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`),
  "CREATE DATABASE identity_service",
]
  .map((statement) => `-c "${statement}"`)
  .join(" ");
const dropped = await runOpsTask({
  label: "drop",
  command: ["bash", "-c", `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres ${drop}`],
});
if (dropped.exitCode !== 0)
  throw new Error(`Dropping the databases failed (exit ${dropped.exitCode}):\n${dropped.text}`);
node("tools/aws-migrate.mjs");

step("4/4 Start the services and load the data");
node("tools/aws-tf.mjs", "apply", "-auto-approve", `-var=image_tag=${tag}`, "-var=services_enabled=true");
stable(databaseServices);
node("tools/aws-seed.mjs");
console.log("\nReset complete.");
