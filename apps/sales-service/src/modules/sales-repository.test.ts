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
  values(value: unknown): InsertQuery;
  onConflictDoNothing(options: unknown): InsertQuery;
  returning(): Promise<unknown[]>;
};

const cart = {
  id: "00000000-0000-4000-8000-000000000001",
  customerId: null,
  guestTokenDigest: "",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const createConcurrentGuestCartDatabase = (): SalesDatabase => {
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
        const input = value as { guestTokenDigest: string };
        cart.guestTokenDigest = input.guestTokenDigest;
        return query;
      },
      onConflictDoNothing() {
        ignoreConflict = true;
        return query;
      },
      async returning() {
        if (cartExists) {
          if (ignoreConflict) return [];
          const error = new Error("duplicate guest cart") as Error & { code: string };
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

describe("SalesRepository guest carts", () => {
  it("returns one cart when concurrent requests create the same guest cart", async () => {
    const repository = new SalesRepository(createConcurrentGuestCartDatabase());

    const carts = await Promise.all([
      repository.getOrCreateCart(undefined, "guest-token"),
      repository.getOrCreateCart(undefined, "guest-token"),
    ]);

    expect(carts.map((value) => value.id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
    ]);
  });
});
