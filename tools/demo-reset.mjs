// Demo reset: wipes the data of every service and seeds it again, so the whole dataset is dated today.
// `pnpm run demo:reset` before a presentation is the one command that makes the shelves, the 60-day trend, the expiry
// countdowns and the action plans agree with the clock. Container mode only (the stack from `pnpm run aws`).
//
// It is destructive on purpose: the seven service databases are dropped and recreated, and the Typesense volume is
// removed. It refuses NODE_ENV=production and any API_BASE_URL that is not a loopback host, like the demo seed.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Set it in your .env file.`);
  return value;
};

if (process.env.NODE_ENV === "production") {
  throw new Error("demo:reset is a development tool and refuses to run with NODE_ENV=production.");
}
const apiHost = new URL(requireEnv("API_BASE_URL")).hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(apiHost)) {
  throw new Error(`Refusing to wipe data behind ${apiHost}: only a local gateway is allowed.`);
}
const postgresUser = requireEnv("POSTGRES_USER");
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run this through pnpm: pnpm run demo:reset");

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const databases = [
  "identity_service",
  "catalog_service",
  "inventory_service",
  "sales_service",
  "payment_service",
  "operations_query_service",
  "chatbot_service",
];
// The services that own those databases and everything that reads them. They stop before the wipe and start after the
// migrations, `--no-deps` so that an unhealthy Typesense cannot hold them back (search falls back to catalog-service).
const services = [
  "identity-service",
  "catalog-service",
  "inventory-service",
  "sales-service",
  "payment-service",
  "operations-query-service",
  "chatbot-service",
  "search-service",
  "ops-console-service",
];

const run = (command, args, { input, allowFailure = false, show = false } = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    input,
    encoding: "utf8",
    stdio: show ? ["pipe", "inherit", "inherit"] : "pipe",
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result;
};
const compose = (args, options) => run("docker", ["compose", ...args], options);
const pnpmRun = (script) => {
  const [command, args] = /\.[cm]?js$/.test(pnpm) ? [process.execPath, [pnpm, "run", script]] : [pnpm, ["run", script]];
  return run(command, args, { show: true });
};
const psql = (database, sql) =>
  compose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    postgresUser,
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-c",
    sql,
  ]).stdout.trim();
const step = (message) => console.log(`\n== ${message}`);

step("Stopping the services");
compose(["stop", ...services]);

step("Recreating the service databases");
for (const database of databases) {
  psql("postgres", `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  psql("postgres", `CREATE DATABASE ${database}`);
}
psql("catalog_service", "CREATE EXTENSION IF NOT EXISTS postgis");
compose(["run", "--rm", "postgres-roles"]);

step("Clearing the search index");
compose(["rm", "-sf", "typesense"]);
const volumes = run("docker", ["volume", "ls", "-q", "--filter", "name=typesense-data"])
  .stdout.split("\n")
  .filter(Boolean);
for (const volume of volumes) run("docker", ["volume", "rm", volume]);
// Not waited for: when Typesense cannot start, search answers through catalog-service and the demo still works.
if (compose(["up", "-d", "typesense"], { allowFailure: true }).status !== 0)
  console.warn("Typesense did not start. Search falls back to catalog-service.");

step("Migrating");
pnpmRun("db:migrate");

step("Starting the services");
compose(["up", "-d", "--no-deps", "--wait", ...services], { show: true });

step("Seeding");
pnpmRun("seed:default");
pnpmRun("seed:demo");

// Automatic action plans are raised when inventory-service starts, so restart it now that the shop has stock.
step("Raising the automatic action plans");
compose(["restart", "inventory-service"]);
compose(["up", "-d", "--no-deps", "--wait", "inventory-service"]);
let plans = 0;
for (let attempt = 0; attempt < 30 && plans === 0; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  plans = Number(psql("inventory_service", "SELECT count(*) FROM action_plans"));
}
console.log(`${plans} action plan(s) raised.`);
console.log(`\nDemo data is dated ${new Date().toISOString().slice(0, 10)}. Follow docs/demo-walkthrough.md.`);
