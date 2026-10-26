import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres/session";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Pool } from "pg";

import * as schema from "./schema.ts";

export type IdentityDatabase = { db: ReturnType<typeof drizzle<typeof schema>>; pool: Pool };

/**
 * Anything that runs queries: the pool-backed database or one transaction on it. Repositories take this type, so the
 * same code writes either alone or inside the transaction a unit of work opens.
 */
export type IdentityExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export const createIdentityDatabase = (connectionString = process.env.DATABASE_URL): IdentityDatabase | undefined => {
  if (!connectionString) return undefined;
  const pool = new Pool({ connectionString, max: 10 });
  return { db: drizzle({ client: pool, schema }), pool };
};
