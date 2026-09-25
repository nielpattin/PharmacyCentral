import { argon2, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { Client } from "pg";

const derivePassword = promisify(argon2);
const requireEnvironmentVariable = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Please set it in your .env file.`);
  return value;
};
const dryRun = process.argv.includes("--dry-run");
if (dryRun) {
  console.log(JSON.stringify({ service: "identity-service", status: "dry-run" }));
  process.exit(0);
}

const connectionString = (() => {
  const url = new URL(requireEnvironmentVariable("DATABASE_URL"));
  url.pathname = "/identity_service";
  return url.toString();
})();

const demoAccountPassword = requireEnvironmentVariable("DEMO_ACCOUNT_PASSWORD");

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");
  const passwordHash = await hashPassword(demoAccountPassword);
  const users = [
    ["00000000-0000-4000-8000-000000000001", "employee", "admin@pharmacycentral.vn", "Nguyễn Quốc Bảo"],
    ["00000000-0000-4000-8000-000000000002", "customer", "khachhang@pharmacycentral.vn", "Trần Thu Hà"],
    ["00000000-0000-4000-8000-000000000003", "employee", "manager@pharmacycentral.vn", "Lê Minh Châu"],
  ];
  for (const [id, actorType, email, displayName] of users) {
    await client.query(
      `INSERT INTO users (id, actor_type, email, display_name, password_hash, email_verified_at, is_active) VALUES ($1, $2, $3, $4, $5, now(), true) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, actor_type = EXCLUDED.actor_type, display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, email_verified_at = EXCLUDED.email_verified_at, is_active = true`,
      [id, actorType, email, displayName, passwordHash],
    );
  }
  await client.query(
    `INSERT INTO user_roles (user_id, role_name) VALUES ('00000000-0000-4000-8000-000000000001', 'Platform Admin'), ('00000000-0000-4000-8000-000000000003', 'Pharmacy Manager'), ('00000000-0000-4000-8000-000000000003', 'Pharmacist') ON CONFLICT DO NOTHING`,
  );
  await client.query("COMMIT");
  console.log(
    JSON.stringify({ service: "identity-service", status: "seeded", scope: "accounts", idempotency: "user-ids" }),
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
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
