import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for migrations");
}

const defaultMigrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle/migrations");
const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_DIR ?? defaultMigrationsFolder;

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle({ client: pool });

try {
  await migrate(db, { migrationsFolder });
} finally {
  await pool.end();
}
