import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CatalogDatabase } from "../../../../../shared/infrastructure/database.ts";
import * as schema from "../../../../../shared/infrastructure/schema.ts";
import { DrizzleSearchSynonymStore } from "./drizzle-search-synonym-store.ts";

const ACTOR = "77777777-7777-4777-8777-777777777777";
const OTHER = "88888888-8888-4888-8888-888888888888";

describe("DrizzleSearchSynonymStore", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const store = new DrizzleSearchSynonymStore({ db, pool: undefined } as unknown as CatalogDatabase);

  beforeAll(async () => {
    const migration = new URL("../../../../../../drizzle/migrations/0009_tense_leader.sql", import.meta.url);
    await client.exec(await readFile(migration, "utf8"));
  });

  beforeEach(async () => {
    await client.exec("DELETE FROM search_synonym_groups");
  });

  afterAll(async () => {
    await client.close();
  });

  it("inserts a pending group at version 1 and reads it back", async () => {
    const created = await store.transaction((tx) =>
      tx.insert({ terms: ["tiêu chảy", "đi ngoài"], submittedBy: ACTOR, submittedAt: "2026-10-20T08:00:00.000Z" }),
    );

    expect(created).toEqual({
      id: created.id,
      terms: ["tiêu chảy", "đi ngoài"],
      version: 1,
      submittedBy: ACTOR,
      submittedAt: "2026-10-20T08:00:00.000Z",
      status: "pending",
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.list()).toEqual([created]);
  });

  it("saves an approval and lists it only among approved groups", async () => {
    const pending = await store.transaction((tx) =>
      tx.insert({ terms: ["ho", "ho khan"], submittedBy: ACTOR, submittedAt: "2026-10-20T08:00:00.000Z" }),
    );
    await store.transaction((tx) =>
      tx.save({
        ...pending,
        version: 2,
        status: "approved",
        approvedBy: OTHER,
        approvedAt: "2026-10-20T09:00:00.000Z",
      }),
    );

    expect(await store.listApproved()).toEqual([
      {
        ...pending,
        version: 2,
        status: "approved",
        approvedBy: OTHER,
        approvedAt: "2026-10-20T09:00:00.000Z",
      },
    ]);
  });

  it("removes a group inside a transaction", async () => {
    const created = await store.transaction((tx) =>
      tx.insert({ terms: ["ho", "ho khan"], submittedBy: ACTOR, submittedAt: "2026-10-20T08:00:00.000Z" }),
    );

    await store.transaction((tx) => tx.remove(created.id));

    expect(await store.list()).toEqual([]);
  });

  it("refuses a row whose terms fail validation on read", async () => {
    await client.query(
      "INSERT INTO search_synonym_groups (terms, version, status, submitted_by, submitted_at) VALUES ($1, 1, 'pending', $2, $3)",
      [JSON.stringify(["only one"]), ACTOR, "2026-10-20T08:00:00.000Z"],
    );

    await expect(store.list()).rejects.toThrow("fail validation");
  });

  it("rejects an approved row without approval columns at the database", async () => {
    await expect(
      client.query(
        "INSERT INTO search_synonym_groups (terms, version, status, submitted_by, submitted_at) VALUES ($1, 2, 'approved', $2, $3)",
        [JSON.stringify(["ho", "ho khan"]), ACTOR, "2026-10-20T08:00:00.000Z"],
      ),
    ).rejects.toThrow("search_synonym_groups_review_check");
  });
});
