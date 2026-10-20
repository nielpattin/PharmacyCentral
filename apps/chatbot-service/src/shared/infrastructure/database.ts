import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.ts";

export type ChatDrizzleDatabase = NodePgDatabase<typeof schema>;

export type ChatDatabase = { db: ChatDrizzleDatabase; pool: Pool };

export const createChatDatabase = (connectionString: string): ChatDatabase => {
  const pool = new Pool({ connectionString, max: 10 });
  return { db: drizzle({ client: pool, schema }), pool };
};
