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

// Every service connects as its own role, which can open only its own database (deploy/local/postgres/roles.sh). The
// host and port come from DATABASE_URL; the role is named like the database and takes its password from the
// matching variable.
const databaseUrl = (database, passwordVariable) => {
  const url = new URL(requireEnvironmentVariable("DATABASE_URL"));
  url.pathname = `/${database}`;
  url.username = database;
  url.password = requireEnvironmentVariable(passwordVariable);
  return url.toString();
};

const demoAccountPassword = requireEnvironmentVariable("DEMO_ACCOUNT_PASSWORD");

/**
 * One account per role, each holding only that role, so signing in as one shows exactly what the role may do.
 * Site access names `catalog_service` site codes from `data/import-samples/sites.csv`; Platform Admin needs none.
 */
const accounts = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    actorType: "employee",
    email: "admin@pharmacycentral.vn",
    displayName: "Nguyễn Quốc Bảo",
    roles: ["Platform Admin"],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    actorType: "customer",
    email: "khachhang@pharmacycentral.vn",
    displayName: "Trần Thu Hà",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    actorType: "employee",
    email: "manager@pharmacycentral.vn",
    displayName: "Lê Minh Châu",
    roles: ["Pharmacy Manager"],
    siteCodes: ["SITE-RTL"],
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    actorType: "employee",
    email: "pharmacist@pharmacycentral.vn",
    displayName: "Phạm Thị Lan",
    roles: ["Pharmacist"],
    siteCodes: ["SITE-RTL"],
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    actorType: "employee",
    email: "warehouse@pharmacycentral.vn",
    displayName: "Võ Văn Hùng",
    roles: ["Warehouse Staff"],
    siteCodes: ["SITE-WH"],
  },
  // More shoppers, so the order lists and the pharmacist queue show different people rather than one account.
  {
    id: "00000000-0000-4000-8000-000000000006",
    actorType: "customer",
    email: "nguyen.lan@example.com",
    displayName: "Nguyễn Thị Lan Anh",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000007",
    actorType: "customer",
    email: "tran.minh.khoa@example.com",
    displayName: "Trần Minh Khoa",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000008",
    actorType: "customer",
    email: "le.thanh.huong@example.com",
    displayName: "Lê Thanh Hương",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000009",
    actorType: "customer",
    email: "pham.quoc.viet@example.com",
    displayName: "Phạm Quốc Việt",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000010",
    actorType: "customer",
    email: "vo.ngoc.mai@example.com",
    displayName: "Võ Ngọc Mai",
    roles: [],
    siteCodes: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000011",
    actorType: "customer",
    email: "dang.hoang.nam@example.com",
    displayName: "Đặng Hoàng Nam",
    roles: [],
    siteCodes: [],
  },
];

// Sites are imported master data with generated ids, so the seed looks their codes up rather than inventing ids.
// A fresh machine may not have the catalog database or its `sites` table yet; the accounts then still seed without
// site access, because the administrator being seeded is who imports the sites afterwards.
const siteCodes = [...new Set(accounts.flatMap((account) => account.siteCodes))];
const siteIdsByCode = new Map();
const catalog = new Client({ connectionString: databaseUrl("catalog_service", "CATALOG_DB_PASSWORD") });
let catalogConnected = false;
try {
  await catalog.connect();
  catalogConnected = true;
  const sites = await catalog.query("SELECT id, code FROM sites WHERE code = ANY($1)", [siteCodes]);
  for (const row of sites.rows) siteIdsByCode.set(row.code, row.id);
} catch (error) {
  console.warn(
    `The catalog sites lookup failed, so the accounts below seed without site access: ${siteCodes.join(", ")} (${error instanceof Error ? error.message : String(error)})`,
  );
} finally {
  if (catalogConnected) await catalog.end();
}
const missingSites = siteCodes.filter((code) => !siteIdsByCode.has(code));

const client = new Client({ connectionString: databaseUrl("identity_service", "IDENTITY_DB_PASSWORD") });
await client.connect();

try {
  await client.query("BEGIN");
  const passwordHash = await hashPassword(demoAccountPassword);
  for (const account of accounts) {
    await client.query(
      `INSERT INTO users (id, actor_type, email, display_name, password_hash, email_verified_at, is_active, must_change_password) VALUES ($1, $2, $3, $4, $5, now(), true, false) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, actor_type = EXCLUDED.actor_type, display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, email_verified_at = EXCLUDED.email_verified_at, is_active = true, must_change_password = false`,
      [account.id, account.actorType, account.email, account.displayName, passwordHash],
    );
    // Re-seeding resets roles and sites, so a role or site added by hand never lingers on a demo account.
    await client.query("DELETE FROM user_roles WHERE user_id = $1", [account.id]);
    await client.query("DELETE FROM user_site_scopes WHERE user_id = $1", [account.id]);
    for (const role of account.roles) {
      await client.query("INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2)", [account.id, role]);
    }
    for (const code of account.siteCodes) {
      if (!siteIdsByCode.has(code)) continue;
      await client.query("INSERT INTO user_site_scopes (user_id, site_id) VALUES ($1, $2)", [
        account.id,
        siteIdsByCode.get(code),
      ]);
    }
  }
  await client.query("COMMIT");
  console.log(
    JSON.stringify({ service: "identity-service", status: "seeded", scope: "accounts", idempotency: "user-ids" }),
  );
  console.table(
    accounts.map((account) => ({
      email: account.email,
      roles: account.roles.join(", ") || "(customer)",
      sites: account.roles.includes("Platform Admin")
        ? "all"
        : account.siteCodes.filter((code) => siteIdsByCode.has(code)).join(", ") || "-",
    })),
  );
  // The accounts still seed before any import, because the admin is who imports the sites.
  if (missingSites.length) {
    console.warn(
      `Sites ${missingSites.join(", ")} are not imported yet, so the accounts above lack that site access. Import data/import-samples/sites.csv, then run pnpm run dev:data again.`,
    );
  }
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
