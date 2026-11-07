// Empties the data of the AWS stack and loads the demo dataset again, without touching the services or the schema. Usage:
//   node tools/aws-reseed.mjs [--yes]
// Faster than aws-reset.mjs: no service is stopped and no database is dropped, so there are no migrations to run. One
// ops task truncates every table in the public schema of the seven service databases (the migration journal lives in
// the drizzle schema and stays), one ops task runs the default seed (the Platform Admin), then aws-seed.mjs loads the demo
// data. RabbitMQ and Typesense are left alone: the search index is rebuilt from the catalog by the seed.
import { createInterface } from "node:readline/promises";
import { execFileSync } from "node:child_process";

import { runOpsTask } from "./lib/aws-ops.mjs";

const databases = [
  "identity_service",
  "catalog_service",
  "inventory_service",
  "sales_service",
  "payment_service",
  "operations_query_service",
  "chatbot_service",
];
const step = (title) => console.log(`\n=== ${title} ===`);

if (!process.argv.includes("--yes")) {
  if (!process.stdin.isTTY) {
    console.error("There is no terminal to ask for confirmation. Run it again with --yes: pnpm run cloud:reseed --yes");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "This deletes ALL rows in the AWS stack databases and loads the demo data again. Type 'reseed' to continue: ",
  );
  rl.close();
  if (answer.trim() !== "reseed") {
    console.log("Aborted.");
    process.exit(1);
  }
}

step("1/3 Empty the tables");
// The RDS admin is not a superuser: it must be a member of the role that owns each database's tables.
const block = `DO $$ DECLARE t text; BEGIN SELECT string_agg(format('%I.%I', schemaname, tablename), ',') INTO t FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user; IF t IS NOT NULL THEN EXECUTE 'TRUNCATE ' || t || ' RESTART IDENTITY CASCADE'; END IF; END $$;`;
const script = databases
  .map(
    (database) =>
      `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "GRANT ${database} TO CURRENT_USER" && ` +
      `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${database} -c "SET ROLE ${database}" -c "\$TRUNCATE_SQL"`,
  )
  .join(" && ");
// The SQL travels in an environment variable so bash never expands the dollar quotes of the DO block.
const truncated = await runOpsTask({
  label: "truncate",
  command: ["bash", "-c", script],
  environment: [{ name: "TRUNCATE_SQL", value: block }],
});
if (truncated.exitCode !== 0)
  throw new Error(`Emptying the tables failed (exit ${truncated.exitCode}):\n${truncated.text}`);

step("2/3 Default seed (Platform Admin)");
const admin = await runOpsTask({ label: "seed", command: ["node", "/ops/seed.mjs"] });
if (admin.exitCode !== 0) throw new Error(`The default seed failed (exit ${admin.exitCode}):\n${admin.text}`);

step("3/3 Demo data");
execFileSync("node", ["tools/aws-seed.mjs"], { stdio: "inherit" });
console.log("\nReseed complete.");
