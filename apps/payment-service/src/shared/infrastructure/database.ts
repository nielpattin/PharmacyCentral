import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../modules/payments/infrastructure/schema.ts";

export type PaymentDatabase = { db: ReturnType<typeof drizzle<typeof schema>>; pool: Pool };

export const createPaymentDatabase = (connectionString = process.env.DATABASE_URL): PaymentDatabase | undefined => {
  if (!connectionString) return undefined;
  const pool = new Pool({ connectionString, max: 10 });
  return { db: drizzle({ client: pool, schema }), pool };
};
