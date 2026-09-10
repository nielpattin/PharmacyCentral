import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.ts";

export type OperationsDatabase = { db: ReturnType<typeof drizzle<typeof schema>>; pool: Pool };

export const createOperationsDatabase = (
  connectionString = process.env.DATABASE_URL,
): OperationsDatabase | undefined => {
  if (!connectionString) return undefined;
  const pool = new Pool({ connectionString, max: 10 });
  return { db: drizzle({ client: pool, schema }), pool };
};
