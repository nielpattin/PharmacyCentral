// Shared by the two seeds and by nothing else: the default seed (seed.mjs) and the demo seed (seed-demo.mjs).
import { argon2, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { Client } from "pg";

const derivePassword = promisify(argon2);

export const requireEnvironmentVariable = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Please set it in your .env file.`);
  return value;
};

// Every service connects as its own role, which can open only its own database (deploy/local/postgres/roles.sh). The
// host and port come from DATABASE_URL; the role is named like the database and takes its password from the
// matching variable.
export const databaseUrl = (database, passwordVariable) => {
  const url = new URL(requireEnvironmentVariable("DATABASE_URL"));
  url.pathname = `/${database}`;
  url.username = database;
  url.password = requireEnvironmentVariable(passwordVariable);
  return url.toString();
};

const hashPassword = async (password) => {
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
};

/**
 * Creates or updates exactly the given accounts, by id, in one transaction. Roles and site access are reset to the
 * given ones, so a role or site added by hand never lingers. No other account is touched.
 * `siteIdsByCode` maps the site codes an account names to catalog site ids.
 */
export const seedAccounts = async ({ accounts, password, siteIdsByCode = new Map() }) => {
  const client = new Client({ connectionString: databaseUrl("identity_service", "IDENTITY_DB_PASSWORD") });
  await client.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await hashPassword(password);
    for (const account of accounts) {
      await client.query(
        `INSERT INTO users (id, actor_type, email, display_name, password_hash, email_verified_at, is_active, must_change_password) VALUES ($1, $2, $3, $4, $5, now(), true, false) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, actor_type = EXCLUDED.actor_type, display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash, email_verified_at = EXCLUDED.email_verified_at, is_active = true, must_change_password = false`,
        [account.id, account.actorType, account.email, account.displayName, passwordHash],
      );
      await client.query("DELETE FROM user_roles WHERE user_id = $1", [account.id]);
      await client.query("DELETE FROM user_site_scopes WHERE user_id = $1", [account.id]);
      for (const role of account.roles) {
        await client.query("INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2)", [account.id, role]);
      }
      for (const code of account.siteCodes) {
        await client.query("INSERT INTO user_site_scopes (user_id, site_id) VALUES ($1, $2)", [
          account.id,
          siteIdsByCode.get(code),
        ]);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
};
