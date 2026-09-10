import { Client } from "pg";

const dryRun = process.argv.includes("--dry-run");
if (dryRun) {
  console.log(JSON.stringify({ service: "inventory-service", status: "dry-run" }));
  process.exit(0);
}

const connectionString = (() => {
  const url = new URL(
    process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "pharmacycentral"}:${process.env.POSTGRES_PASSWORD ?? "change_this_password"}@localhost:5432/inventory_service`,
  );
  url.pathname = "/inventory_service";
  return url.toString();
})();

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  await seedProcurement(client);
  const catalog = await connectDatabase("catalog_service");
  try {
    const product = (await catalog.query("SELECT id FROM products WHERE sku = 'DEMO-001'")).rows[0]?.id;
    const site = (await catalog.query("SELECT id FROM sites WHERE code = 'SITE-WH'")).rows[0]?.id;
    const location = (
      await catalog.query("SELECT id FROM storage_locations WHERE code = 'WH-A' AND site_id = $1", [site])
    ).rows[0]?.id;
    const supplier = (await catalog.query("SELECT id FROM suppliers WHERE code = 'SUP-001'")).rows[0]?.id;
    if (!product || !site || !location) throw new Error("Catalog seed must run before inventory seed");
    const batchId = "00000000-0000-4200-8200-000000000201";
    await client.query(
      `INSERT INTO product_batches (id, product_id, supplier_id, batch_number, manufactured_date, expiry_date, quality_status, is_active) VALUES ($1, $2, $3, 'DEMO-BATCH-001', '2025-01-01', '2027-01-01', 'Released', true) ON CONFLICT (id) DO UPDATE SET expiry_date = EXCLUDED.expiry_date, quality_status = 'Released', is_active = true`,
      [batchId, product, supplier ?? null],
    );
    await client.query(
      `INSERT INTO inventory_balances (id, product_batch_id, site_id, storage_location_id, quantity_on_hand, quantity_reserved, version) VALUES ($1, $2, $3, $4, 100, 0, 0) ON CONFLICT (product_batch_id, storage_location_id) DO UPDATE SET quantity_on_hand = 100, quantity_reserved = 0, updated_at = now()`,
      ["00000000-0000-4200-8200-000000000202", batchId, site, location],
    );
    await client.query(
      `INSERT INTO stock_ledger_entries (id, product_id, product_batch_id, site_id, storage_location_id, quantity_delta, quantity_after, movement_type, reason) VALUES ($1, $2, $3, $4, $5, 100, 100, 'DemoSeed', 'Deterministic demo seed') ON CONFLICT (id) DO NOTHING`,
      ["00000000-0000-4200-8200-000000000203", product, batchId, site, location],
    );
  } finally {
    await catalog.end();
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ service: "inventory-service", status: "seeded", idempotency: "natural-keys" }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

async function seedProcurement(database) {
  const catalog = await connectDatabase("catalog_service");
  try {
    const supplier = (await catalog.query("SELECT id FROM suppliers WHERE code = 'SUP-001'")).rows[0]?.id;
    const site = (await catalog.query("SELECT id FROM sites WHERE code = 'SITE-WH'")).rows[0]?.id;
    const product = (await catalog.query("SELECT id FROM products WHERE sku = 'DEMO-001'")).rows[0]?.id;
    if (!supplier || !site || !product) throw new Error("Catalog seed must run before procurement seed");
    const orderId = "00000000-0000-4100-8100-000000000101";
    await database.query(
      `INSERT INTO purchase_orders (id, purchase_order_number, supplier_id, site_id, status, notes, created_by) VALUES ($1, 'DEMO-PO-001', $2, $3, 'Approved', 'Deterministic demo purchase order', '00000000-0000-4000-8000-000000000003') ON CONFLICT (purchase_order_number) DO UPDATE SET status = 'Approved', notes = EXCLUDED.notes, updated_at = now()`,
      [orderId, supplier, site],
    );
    const current = (await database.query("SELECT id FROM purchase_orders WHERE purchase_order_number = 'DEMO-PO-001'"))
      .rows[0].id;
    await database.query(
      "INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, ordered_quantity, received_quantity) VALUES ($1, $2, $3, 100, 40) ON CONFLICT (id) DO UPDATE SET ordered_quantity = 100, received_quantity = 40",
      ["00000000-0000-4100-8100-000000000102", current, product],
    );
  } finally {
    await catalog.end();
  }
}

async function connectDatabase(databaseName) {
  const base = new URL(
    process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "pharmacycentral"}:${process.env.POSTGRES_PASSWORD ?? "change_this_password"}@localhost:5432/${databaseName}`,
  );
  base.pathname = `/${databaseName}`;
  const connection = new Client({ connectionString: base.toString() });
  await connection.connect();
  return connection;
}
