import { argon2, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { Client } from "pg";

const derivePassword = promisify(argon2);
const dryRun = process.argv.includes("--dry-run");
if (dryRun) {
  console.log(JSON.stringify({ service: "identity-service", status: "dry-run" }));
  process.exit(0);
}

const connectionString = (() => {
  const url = new URL(
    process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "pharmacycentral"}:${process.env.POSTGRES_PASSWORD ?? "change_this_password"}@localhost:5432/identity_service`,
  );
  url.pathname = "/identity_service";
  return url.toString();
})();

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  const passwordHash = await hashPassword("DemoPassword123!");
  const users = [
    ["00000000-0000-4000-8000-000000000001", "employee", "admin@pharmacycentral.vn", "Nguyễn Quốc Bảo", passwordHash],
    ["00000000-0000-4000-8000-000000000002", "customer", "khachhang@pharmacycentral.vn", "Trần Thu Hà", passwordHash],
    ["00000000-0000-4000-8000-000000000003", "employee", "manager@pharmacycentral.vn", "Lê Minh Châu", passwordHash],
  ];
  for (const [id, actorType, email, displayName, hash] of users) {
    await client.query(
      `INSERT INTO users (id, actor_type, email, display_name, password_hash, email_verified_at, is_active) VALUES ($1, $2, $3, $4, $5, now(), true) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, actor_type = EXCLUDED.actor_type, display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, email_verified_at = EXCLUDED.email_verified_at, is_active = true`,
      [id, actorType, email, displayName, hash],
    );
  }
  await client.query(
    `INSERT INTO user_roles (user_id, role_name) VALUES ('00000000-0000-4000-8000-000000000001', 'Platform Admin'), ('00000000-0000-4000-8000-000000000003', 'Pharmacy Manager') ON CONFLICT DO NOTHING`,
  );
  const catalog = await connectDatabase("catalog_service");
  try {
    const site = await catalog.query("SELECT id FROM sites WHERE code = 'SITE-RTL'");
    if (site.rows[0]) {
      await client.query(
        "INSERT INTO user_site_scopes (user_id, site_id) VALUES ($1, $2), ($3, $2) ON CONFLICT DO NOTHING",
        [users[0][0], site.rows[0].id, users[2][0]],
      );
    }
  } finally {
    await catalog.end();
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ service: "identity-service", status: "seeded", idempotency: "natural-keys" }));
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

async function hashPassword(password) {
  const salt = randomBytes(16);
  const digest = await derivePassword("argon2id", {
    message: Buffer.from(password),
    nonce: salt,
    memory: 19_456,
    passes: 2,
    parallelism: 1,
    tagLength: 32,
    type: "argon2id",
  });
  return `$argon2id$v=19$m=19456,t=2,p=1$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}
