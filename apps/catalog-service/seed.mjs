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
    [
      "SITE-HQ",
      "Trụ sở Pharmacy Central",
      "Headquarters",
      "126 Nguyễn Thị Minh Khai, Quận 3, TP. Hồ Chí Minh",
      false,
      false,
      10.7769,
      106.7009,
    ],
    [
      "SITE-WH",
      "Kho trung tâm Bình Thạnh",
      "Warehouse",
      "212 Điện Biên Phủ, Bình Thạnh, TP. Hồ Chí Minh",
      false,
      false,
      10.789,
      106.72,
    ],
    [
      "SITE-HUB",
      "Kho vệ tinh Phú Nhuận",
      "RegionalHub",
      "15 Hoàng Văn Thụ, Phú Nhuận, TP. Hồ Chí Minh",
      false,
      false,
      10.8,
      106.68,
    ],
    [
      "SITE-RTL",
      "Nhà thuốc Pharmacy Central Quận 4",
      "RetailStore",
      "268 Tôn Đản, Quận 4, TP. Hồ Chí Minh",
      true,
      true,
      10.773,
      106.704,
    ],
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
  const products = [
    ["THU-0001", "Paracetamol 500mg (hộp 100 viên)", "Medicine", "Dược Hậu Giang", "hộp", 12500],
    ["THU-0002", "Amoxicillin 500mg (hộp 100 viên)", "Medicine", "Traphaco", "hộp", 85000],
    ["THU-0003", "Vitamin C 500mg (hộp 100 viên)", "Medicine", "Dược Hậu Giang", "hộp", 45000],
    ["THU-0004", "Ibuprofen 400mg (hộp 100 viên)", "Medicine", "Sanofi", "hộp", 78000],
    ["THU-0005", "Omeprazol 20mg (hộp 30 viên)", "Medicine", "Stada", "hộp", 62000],
    ["THU-0006", "Cetirizin 10mg (hộp 30 viên)", "Medicine", "Traphaco", "hộp", 38000],
    ["THU-0007", "Metformin 500mg (hộp 60 viên)", "Medicine", "Pymepharco", "hộp", 55000],
    ["THU-0008", "Losartan 50mg (hộp 30 viên)", "Medicine", "Domesco", "hộp", 72000],
    ["THU-0009", "Salbutamol 2mg (hộp 60 viên)", "Medicine", "GlaxoSmithKline", "hộp", 48000],
    ["THU-0010", "Oresol 245 (hộp 20 gói)", "Medicine", "Dược Hậu Giang", "hộp", 42000],
    ["THU-0011", "Men vi sinh Enterogermina 5ml (hộp 20 ống)", "Medicine", "Sanofi", "hộp", 165000],
    ["THU-0012", "Dung dịch nước muối sinh lý 0,9% 500ml", "Medical supply", "Dược Hậu Giang", "chai", 12000],
    ["VTYT-001", "Khẩu trang y tế 4 lớp (hộp 50 chiếc)", "Medical supply", "Vật tư Y tế Sài Gòn", "hộp", 65000],
    ["VTYT-002", "Băng gạc y tế 10x10cm (hộp 10 miếng)", "Medical supply", "Vật tư Y tế Sài Gòn", "hộp", 32000],
    ["VTYT-003", "Bơm tiêm 5ml (hộp 100 chiếc)", "Medical supply", "Vinamed", "hộp", 120000],
    ["VTYT-004", "Găng tay y tế Nitrile (hộp 100 chiếc)", "Medical supply", "Vinamed", "hộp", 185000],
    ["VTYT-005", "Nhiệt kế điện tử", "Medical supply", "Omron", "chiếc", 250000],
    ["VTYT-006", "Máy đo huyết áp điện tử", "Medical supply", "Omron", "chiếc", 980000],
    ["VTYT-007", "Bông y tế 100g", "Medical supply", "Vật tư Y tế Sài Gòn", "gói", 28000],
    ["VTYT-008", "Que thử đường huyết (hộp 50 que)", "Medical supply", "Roche", "hộp", 520000],
  ];
  for (const [index, [sku, name, category, manufacturer, unitName, unitPrice]] of products.entries()) {
    const product = await client.query(
      `INSERT INTO products (id, sku, barcode, name, category, manufacturer) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, barcode = EXCLUDED.barcode, category = EXCLUDED.category, manufacturer = EXCLUDED.manufacturer, is_active = true RETURNING id`,
      [sku, `8938500${String(index + 1).padStart(6, "0")}`, name, category, manufacturer],
    );
    const productId = product.rows[0].id;
    await client.query(
      `INSERT INTO product_units (id, product_id, unit_name, conversion_factor_to_base_unit, is_base_unit, is_default_sale_unit, is_default_purchase_unit, sort_order) VALUES (gen_random_uuid(), $1, $2, 1, true, true, true, 0) ON CONFLICT (product_id, unit_name) DO NOTHING`,
      [productId, unitName],
    );
    const unit = await client.query("SELECT id FROM product_units WHERE product_id = $1 AND unit_name = $2", [
      productId,
      unitName,
    ]);
    await client.query(
      `INSERT INTO product_prices (id, product_id, product_unit_id, site_id, unit_price, currency, status, effective_from) SELECT gen_random_uuid(), $1, $2, NULL, $3, 'VND', 'Published', '2025-01-01' WHERE NOT EXISTS (SELECT 1 FROM product_prices WHERE product_id = $1 AND product_unit_id = $2 AND site_id IS NULL AND effective_from = '2025-01-01')`,
      [productId, unit.rows[0].id, String(unitPrice)],
    );
    await client.query(
      `INSERT INTO availability_projections (product_id, site_id, in_stock) VALUES ($1, $2, true) ON CONFLICT (product_id, site_id) DO UPDATE SET in_stock = true, updated_at = now()`,
      [productId, siteIds.get("SITE-RTL")],
    );
  }
  const suppliers = [
    [
      "SUP-001",
      "Nhà phân phối Dược phẩm Sài Gòn",
      "Nguyễn Minh Tuấn",
      "kinhdoanh1@example.com",
      "0901234561",
      "12 Nguyễn Văn Cừ, Quận 5, TP. Hồ Chí Minh",
    ],
    [
      "SUP-002",
      "Công ty Dược phẩm Đông Dương",
      "Trần Thị Hồng",
      "kinhdoanh2@example.com",
      "0901234562",
      "45 Cách Mạng Tháng Tám, Quận 3, TP. Hồ Chí Minh",
    ],
    [
      "SUP-003",
      "Công ty Vật tư Y tế Thành phố",
      "Lê Quang Huy",
      "kinhdoanh3@example.com",
      "0901234563",
      "88 Trường Chinh, Tân Bình, TP. Hồ Chí Minh",
    ],
    [
      "SUP-004",
      "Nhà phân phối Thiết bị Y tế Việt",
      "Phạm Thu Trang",
      "kinhdoanh4@example.com",
      "0901234564",
      "31 Lý Thường Kiệt, Quận 10, TP. Hồ Chí Minh",
    ],
    [
      "SUP-005",
      "Công ty Dược phẩm Miền Đông",
      "Đỗ Văn Khánh",
      "kinhdoanh5@example.com",
      "0901234565",
      "7 Xa lộ Hà Nội, Thủ Đức, TP. Hồ Chí Minh",
    ],
  ];
  for (const [code, name, contactName, email, phone, address] of suppliers) {
    await client.query(
      `INSERT INTO suppliers (id, code, name, contact_name, email, phone, address) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, contact_name = EXCLUDED.contact_name, email = EXCLUDED.email, phone = EXCLUDED.phone, address = EXCLUDED.address, is_active = true`,
      [code, name, contactName, email, phone, address],
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
