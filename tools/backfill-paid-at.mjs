// Backfills the first payment date of orders and prescriptions from payment-service's invoices.
//
// The sales documents gained `paid_at` with the customer insights of design 0007. Events fill it from now on; a
// database that already holds paid invoices needs this once, or every customer would look new in the period. It is
// idempotent: a date is set only when it is missing or the invoice is older. A refunded invoice counts too, because
// the first purchase still happened. It needs the compose Postgres, like `pnpm run seed:demo`.
//
// Run: pnpm run backfill:paid-at (after `pnpm run db:migrate`).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const postgresUser = process.env.POSTGRES_USER;
if (!postgresUser) throw new Error("POSTGRES_USER is required; run through pnpm, which loads .env");

const script = `
\\connect payment_service
\\copy (select coalesce(order_id, prescription_id) as id, case when order_id is not null then 'order' else 'prescription' end as kind, min(created_at) as paid_at from payment_invoices where status in ('Paid', 'Refunded') and coalesce(order_id, prescription_id) is not null group by 1, 2) to '/tmp/pharmacy-paid-at.csv' csv
\\connect sales_service
create temp table paid_at_seed (id uuid primary key, kind text not null, paid_at timestamptz not null);
\\copy paid_at_seed from '/tmp/pharmacy-paid-at.csv' csv
update orders o set paid_at = p.paid_at from paid_at_seed p
 where p.kind = 'order' and o.id = p.id and (o.paid_at is null or p.paid_at < o.paid_at);
update prescriptions r set paid_at = p.paid_at from paid_at_seed p
 where p.kind = 'prescription' and r.id = p.id and (r.paid_at is null or p.paid_at < r.paid_at);
select 'orders', count(*) filter (where paid_at is not null), count(*) from orders
union all
select 'prescriptions', count(*) filter (where paid_at is not null), count(*) from prescriptions;
`;
const result = spawnSync(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    postgresUser,
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-q",
  ],
  { cwd: repoRoot, input: script, encoding: "utf8" },
);
if (result.status !== 0)
  throw new Error(
    `The backfill needs the compose Postgres (docker compose exec postgres psql): ${
      result.stderr || result.error?.message || "no output"
    }`,
  );
for (const line of result.stdout
  .trim()
  .split("\n")
  .filter((line) => /^(orders|prescriptions)\|/.test(line))) {
  const [table, paid, total] = line.split("|");
  console.log(`${table}: ${paid} of ${total} rows carry a first payment date`);
}
