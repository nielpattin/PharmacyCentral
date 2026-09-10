import { Client } from "pg";

const dryRun = process.argv.includes("--dry-run");
if (dryRun) {
  console.log(JSON.stringify({ service: "catalog-service", status: "dry-run" }));
  process.exit(0);
}

const connectionString = (() => {
  const url = new URL(
    process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "pharmacycentral"}:${process.env.POSTGRES_PASSWORD ?? "change_this_password"}@localhost:5432/catalog_service`,
  );
  url.pathname = "/catalog_service";
  return url.toString();
})();

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  const sites = [
    ["SITE-HQ", "Headquarters", "Headquarters", "1 Pharmacy Central Way", false, false, 10.7769, 106.7009],
    ["SITE-WH", "Main Warehouse", "Warehouse", "2 Logistics Road", false, false, 10.789, 106.72],
    ["SITE-HUB", "Regional Hub", "RegionalHub", "3 Regional Road", false, false, 10.8, 106.68],
    ["SITE-RTL", "District Retail Store", "RetailStore", "4 Retail Street", true, true, 10.773, 106.704],
  ];
  for (const [code, name, siteType, address, isActive, isCustomerFacing, latitude, longitude] of sites) {
    await client.query(
      `
      INSERT INTO sites (id, code, name, site_type, address, is_active, is_customer_facing, location)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326))
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, is_active = EXCLUDED.is_active, is_customer_facing = EXCLUDED.is_customer_facing, location = EXCLUDED.location, updated_at = now()
    `,
      [code, name, siteType, address, isActive, isCustomerFacing, longitude, latitude], // ST_MakePoint takes (longitude, latitude)
    );
  }
  const siteRows = await client.query("SELECT id, code FROM sites WHERE code = ANY($1)", [
    ["SITE-HQ", "SITE-WH", "SITE-HUB", "SITE-RTL"],
  ]);
  const siteIds = new Map(siteRows.rows.map((row) => [row.code, row.id]));
  const locations = [
    ["SITE-HQ", "HQ-MAIN", "Main", "Main"],
    ["SITE-WH", "WH-A", "Warehouse A", "Warehouse"],
    ["SITE-WH", "WH-B", "Warehouse B", "Warehouse"],
    ["SITE-HUB", "HUB-MAIN", "Hub storage", "Warehouse"],
    ["SITE-RTL", "RTL-FRONT", "Retail floor", "Retail"],
    ["SITE-RTL", "RTL-BACK", "Retail backroom", "Backroom"],
  ];
  for (const [siteCode, code, name, locationType] of locations) {
    await client.query(
      `INSERT INTO storage_locations (id, site_id, code, name, location_type) VALUES (gen_random_uuid(), $1, $2, $3, $4) ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name, location_type = EXCLUDED.location_type, is_active = true`,
      [siteIds.get(siteCode), code, name, locationType],
    );
  }
  for (let index = 1; index <= 20; index += 1) {
    const sku = `DEMO-${String(index).padStart(3, "0")}`;
    const product = await client.query(
      `INSERT INTO products (id, sku, barcode, name, category, manufacturer) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, manufacturer = EXCLUDED.manufacturer, is_active = true RETURNING id`,
      [
        sku,
        `893850${String(index).padStart(6, "0")}`,
        `Demo product ${index}`,
        index <= 12 ? "Medicine" : "Medical supply",
        "Pharmacy Central Demo",
      ],
    );
    const productId = product.rows[0].id;
    await client.query(
      `INSERT INTO product_units (id, product_id, unit_name, conversion_factor_to_base_unit, is_base_unit, is_default_sale_unit, is_default_purchase_unit, sort_order) VALUES (gen_random_uuid(), $1, 'box', 1, true, true, true, 0) ON CONFLICT (product_id, unit_name) DO NOTHING`,
      [productId],
    );
    const unit = await client.query("SELECT id FROM product_units WHERE product_id = $1 AND unit_name = 'box'", [
      productId,
    ]);
    await client.query(
      `INSERT INTO product_prices (id, product_id, product_unit_id, site_id, unit_price, currency, status, effective_from) SELECT gen_random_uuid(), $1, $2, NULL, $3, 'VND', 'Published', '2025-01-01' WHERE NOT EXISTS (SELECT 1 FROM product_prices WHERE product_id = $1 AND product_unit_id = $2 AND site_id IS NULL AND effective_from = '2025-01-01')`,
      [productId, unit.rows[0].id, String(10000 + index * 2500)],
    );
    await client.query(
      `INSERT INTO availability_projections (product_id, site_id, in_stock) VALUES ($1, $2, true) ON CONFLICT (product_id, site_id) DO UPDATE SET in_stock = true, updated_at = now()`,
      [productId, siteIds.get("SITE-RTL")],
    );
  }
  for (let index = 1; index <= 5; index += 1) {
    await client.query(
      `INSERT INTO suppliers (id, code, name, contact_name, email, phone, address) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, contact_name = EXCLUDED.contact_name, email = EXCLUDED.email, phone = EXCLUDED.phone, address = EXCLUDED.address, is_active = true`,
      [
        `SUP-${String(index).padStart(3, "0")}`,
        `Demo Supplier ${index}`,
        `Supplier Contact ${index}`,
        `supplier${index}@example.test`,
        `09000000${index}`,
        `Supplier Road ${index}`,
      ],
    );
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ service: "catalog-service", status: "seeded", idempotency: "natural-keys" }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
