import { describe, expect, it } from "vitest";

import type { SalesDatabase } from "../shared/infrastructure/database.ts";
import { carts } from "../shared/infrastructure/schema.ts";
import { SalesRepository } from "./sales-repository.ts";

type SelectQuery = {
  from(table: unknown): SelectQuery;
  where(condition: unknown): SelectQuery;
  limit(value: number): Promise<unknown[]>;
  orderBy(...orders: unknown[]): Promise<unknown[]>;
};

type InsertQuery = {
  values(value: { customerId: string }): InsertQuery;
  onConflictDoNothing(options: unknown): InsertQuery;
  returning(): Promise<unknown[]>;
};

const cart = {
  id: "00000000-0000-4000-8000-000000000001",
  customerId: "",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const createConcurrentCartDatabase = (): SalesDatabase => {
  let cartExists = false;
  let initialReads = 0;
  let releaseInitialReads: (() => void) | undefined;
  const initialReadsReleased = new Promise<void>((resolve) => {
    releaseInitialReads = resolve;
  });

  const select = (): SelectQuery => {
    let table: unknown;
    const query: SelectQuery = {
      from(nextTable) {
        table = nextTable;
        return query;
      },
      where() {
        return query;
      },
      async limit() {
        if (table === carts && initialReads < 2) {
          initialReads += 1;
          if (initialReads === 2) releaseInitialReads?.();
          await initialReadsReleased;
          return [];
        }
        return table === carts && cartExists ? [cart] : [];
      },
      async orderBy() {
        return [];
      },
    };
    return query;
  };

  const insert = (): InsertQuery => {
    let ignoreConflict = false;
    const query: InsertQuery = {
      values(value) {
        cart.customerId = value.customerId;
        return query;
      },
      onConflictDoNothing() {
        ignoreConflict = true;
        return query;
      },
      async returning() {
        if (cartExists) {
          if (ignoreConflict) return [];
          const error = new Error("duplicate account cart") as Error & { code: string };
          error.code = "23505";
          throw error;
        }
        cartExists = true;
        return [cart];
      },
    };
    return query;
  };

  return { db: { select, insert } as never, pool: undefined as never };
};

describe("SalesRepository account carts", () => {
  it("returns one cart when concurrent requests create the same account cart", async () => {
    const repository = new SalesRepository(createConcurrentCartDatabase());

    const carts = await Promise.all([
      repository.getOrCreateCart("00000000-0000-4000-8000-0000000000aa"),
      repository.getOrCreateCart("00000000-0000-4000-8000-0000000000aa"),
    ]);

    expect(carts.map((value) => value.id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
    ]);
  });
});
