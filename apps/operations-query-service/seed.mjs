import { Client } from "pg";

const dryRun = process.argv.includes("--dry-run");
if (dryRun) {
  console.log(JSON.stringify({ service: "operations-query-service", status: "dry-run" }));
  process.exit(0);
}

const connectionString = (() => {
  const url = new URL(
    process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "pharmacycentral"}:${process.env.POSTGRES_PASSWORD ?? "change_this_password"}@localhost:5432/operations_query_service`,
  );
  url.pathname = "/operations_query_service";
  return url.toString();
})();

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO audit_events (event_id, actor_id, action, entity_type, entity_id, payload, occurred_at) VALUES ($1, '00000000-0000-4000-8000-000000000001', 'SeedInitialDataset', 'System', $1, '{"source":"deterministic seed"}', now()) ON CONFLICT (event_id) DO UPDATE SET action = EXCLUDED.action, entity_type = EXCLUDED.entity_type, payload = EXCLUDED.payload`,
    ["00000000-0000-4500-8500-000000000501"],
  );
  await client.query(
    `INSERT INTO projection_counters (key, value) VALUES ('catalog_products', 20), ('catalog_sites', 4), ('catalog_active_sites', 4) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
  );
  await client.query("COMMIT");
  console.log(JSON.stringify({ service: "operations-query-service", status: "seeded", idempotency: "natural-keys" }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
