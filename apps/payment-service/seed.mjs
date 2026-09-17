import { Client } from "pg";

const dryRun = process.argv.includes("--dry-run");
if (dryRun) {
  console.log(JSON.stringify({ service: "payment-service", status: "dry-run" }));
  process.exit(0);
}

const connectionString = (() => {
  const url = new URL(
    process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "pharmacycentral"}:${process.env.POSTGRES_PASSWORD ?? "change_this_password"}@localhost:5432/payment_service`,
  );
  url.pathname = "/payment_service";
  return url.toString();
})();

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  const invoiceId = "00000000-0000-4400-8400-000000000401";
  await client.query(
    `INSERT INTO payment_invoices (id, payment_code, customer_id, amount, currency, status) VALUES ($1, 'PC-5B3F7A1C9E24D608', '00000000-0000-4000-8000-000000000002', 12500, 'VND', 'Pending') ON CONFLICT (id) DO UPDATE SET payment_code = EXCLUDED.payment_code, amount = 12500, status = 'Pending', updated_at = now()`,
    [invoiceId],
  );
  await client.query(
    `INSERT INTO payment_invoice_lines (id, payment_invoice_id, product_id, product_unit_id, description, quantity, unit_price, currency) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'Paracetamol 500mg (hộp 100 viên)', 1, 12500, 'VND') ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description, quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price`,
    ["00000000-0000-4400-8400-000000000402", invoiceId],
  );
  await client.query("COMMIT");
  console.log(JSON.stringify({ service: "payment-service", status: "seeded", idempotency: "natural-keys" }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
