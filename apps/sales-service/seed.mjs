import { Client } from "pg";

const dryRun = process.argv.includes("--dry-run");
if (dryRun) {
  console.log(JSON.stringify({ service: "sales-service", status: "dry-run" }));
  process.exit(0);
}

const connectionString = (() => {
  const url = new URL(
    process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "pharmacycentral"}:${process.env.POSTGRES_PASSWORD ?? "change_this_password"}@localhost:5432/sales_service`,
  );
  url.pathname = "/sales_service";
  return url.toString();
})();

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  const catalog = await connectDatabase("catalog_service");
  try {
    const product = (await catalog.query("SELECT id FROM products WHERE sku = 'DEMO-001'")).rows[0]?.id;
    const unit = (
      await catalog.query("SELECT id FROM product_units WHERE product_id = $1 AND unit_name = 'box'", [product])
    ).rows[0]?.id;
    const store = (await catalog.query("SELECT id FROM sites WHERE code = 'SITE-RTL'")).rows[0]?.id;
    if (!product || !unit || !store) throw new Error("Catalog seed must run before sales seed");
    const customerId = "00000000-0000-4000-8000-000000000002";
    const cartId = "00000000-0000-4300-8300-000000000301";
    await client.query(
      `INSERT INTO carts (id, customer_id, updated_at) VALUES ($1, $2, now()) ON CONFLICT (customer_id) DO UPDATE SET updated_at = now()`,
      [cartId, customerId],
    );
    const actualCart = (await client.query("SELECT id FROM carts WHERE customer_id = $1", [customerId])).rows[0].id;
    await client.query(
      `INSERT INTO cart_lines (id, cart_id, product_id, product_unit_id, quantity) VALUES ($1, $2, $3, $4, 2) ON CONFLICT (id) DO UPDATE SET quantity = 2`,
      ["00000000-0000-4300-8300-000000000302", actualCart, product, unit],
    );
    const orderId = "00000000-0000-4300-8300-000000000303";
    await client.query(
      `INSERT INTO orders (id, customer_id, status, fulfillment_type, selected_store_id, subtotal, delivery_fee, currency) VALUES ($1, $2, 'Confirmed', 'pickup', $3, 12500, 0, 'VND') ON CONFLICT (id) DO UPDATE SET status = 'Confirmed', updated_at = now()`,
      [orderId, customerId, store],
    );
    await client.query(
      `INSERT INTO order_lines (id, order_id, product_id, product_unit_id, product_name_snapshot, unit_price_snapshot, quantity) VALUES ($1, $2, $3, $4, 'Demo product 1', 12500, 1) ON CONFLICT (id) DO NOTHING`,
      ["00000000-0000-4300-8300-000000000304", orderId, product, unit],
    );
  } finally {
    await catalog.end();
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ service: "sales-service", status: "seeded", idempotency: "natural-keys" }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
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
