import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SynonymSetItem } from "../product-search-index.ts";
import type { CatalogDatabase } from "../../../../shared/infrastructure/database.ts";
import * as schema from "../../../../shared/infrastructure/schema.ts";
import { DrizzleSearchSynonymStore } from "./infrastructure/drizzle-search-synonym-store.ts";
import { SearchSynonymError, SearchSynonymService } from "./search-synonym-service.ts";

const SUBMITTER = "11111111-1111-4111-8111-111111111111";
const REVIEWER = "22222222-2222-4222-8222-222222222222";
const TERMS = ["tiêu chảy", "đi ngoài"];

const expectError = async (work: Promise<unknown>, code: SearchSynonymError["code"]): Promise<void> => {
  await expect(work).rejects.toMatchObject({ code });
};

describe("SearchSynonymService", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const store = new DrizzleSearchSynonymStore({ db, pool: undefined } as unknown as CatalogDatabase);
  const syncSynonyms = vi.fn(async (_items: SynonymSetItem[]) => undefined);
  const logger = { warn: vi.fn() };
  let clock = 0;
  const service = new SearchSynonymService({
    store,
    syncSynonyms,
    logger,
    clock: () => new Date(Date.UTC(2026, 9, 20, 8, 0, clock)),
    newId: () => crypto.randomUUID(),
  });

  beforeAll(async () => {
    const migration = new URL("../../../../../drizzle/migrations/0009_tense_leader.sql", import.meta.url);
    await client.exec(await readFile(migration, "utf8"));
  });

  beforeEach(async () => {
    await client.exec("DELETE FROM search_synonym_groups");
    syncSynonyms.mockClear();
    logger.warn.mockClear();
    clock = 0;
  });

  afterAll(async () => {
    await client.close();
  });

  it("creates a pending group at version 1", async () => {
    const created = await service.create({ actorId: SUBMITTER, terms: TERMS });

    expect(created).toMatchObject({ version: 1, status: "pending", submittedBy: SUBMITTER, terms: TERMS });
  });

  it("resets an approved group to pending and bumps the version when it is edited", async () => {
    const created = await service.create({ actorId: SUBMITTER, terms: TERMS });
    await service.approve({ actorId: REVIEWER, id: created.id, version: 1 });

    const edited = await service.update({
      actorId: SUBMITTER,
      id: created.id,
      terms: ["tieu chay", "di ngoai", "ia chay"],
      version: 2,
    });

    expect(edited).toMatchObject({ version: 3, status: "pending", submittedBy: SUBMITTER });
    expect(await service.list()).toEqual([edited]);
  });

  it("refuses a self-approval with self_review_forbidden", async () => {
    const created = await service.create({ actorId: SUBMITTER, terms: TERMS });

    await expectError(service.approve({ actorId: SUBMITTER, id: created.id, version: 1 }), "self_review_forbidden");
  });

  it("approves a group submitted by someone else and records the approver", async () => {
    const created = await service.create({ actorId: SUBMITTER, terms: TERMS });

    const approved = await service.approve({ actorId: REVIEWER, id: created.id, version: 1 });

    expect(approved).toMatchObject({
      version: 2,
      status: "approved",
      submittedBy: SUBMITTER,
      approvedBy: REVIEWER,
    });
  });

  it("refuses to approve a group that is already approved", async () => {
    const created = await service.create({ actorId: SUBMITTER, terms: TERMS });
    await service.approve({ actorId: REVIEWER, id: created.id, version: 1 });

    await expectError(service.approve({ actorId: REVIEWER, id: created.id, version: 2 }), "already_approved");
  });

  it("refuses an approval or an edit with a stale version", async () => {
    const created = await service.create({ actorId: SUBMITTER, terms: TERMS });

    await expectError(service.approve({ actorId: REVIEWER, id: created.id, version: 9 }), "version_conflict");
    await expectError(
      service.update({ actorId: REVIEWER, id: created.id, terms: TERMS, version: 9 }),
      "version_conflict",
    );
  });

  it("answers search_synonym_not_found for an unknown id", async () => {
    await expectError(
      service.update({ actorId: REVIEWER, id: crypto.randomUUID(), terms: TERMS, version: 1 }),
      "search_synonym_not_found",
    );
  });

  it("deletes a group", async () => {
    const created = await service.create({ actorId: SUBMITTER, terms: TERMS });

    await service.delete({ id: created.id });

    expect(await service.list()).toEqual([]);
  });

  it("refuses two terms that fold to the same text", async () => {
    await expectError(service.create({ actorId: SUBMITTER, terms: ["Tiêu chảy", "tieu chay"] }), "invalid_request");
  });

  it("lists pending groups first, then approved, newest submission first within each", async () => {
    clock = 1;
    const oldestApproved = await service.create({ actorId: SUBMITTER, terms: ["ho", "ho khan"] });
    await service.approve({ actorId: REVIEWER, id: oldestApproved.id, version: 1 });
    clock = 2;
    const olderPending = await service.create({ actorId: SUBMITTER, terms: ["sot", "nong sot"] });
    clock = 3;
    const newerPending = await service.create({ actorId: SUBMITTER, terms: ["ho", "ho dam"] });

    const listed = await service.list();

    expect(listed.map((group) => group.id)).toEqual([newerPending.id, olderPending.id, oldestApproved.id]);
  });

  describe("pushing the approved set", () => {
    it("pushes after an approval, with folded terms", async () => {
      const created = await service.create({ actorId: SUBMITTER, terms: TERMS });
      await service.approve({ actorId: REVIEWER, id: created.id, version: 1 });
      await service.pushesSettled();

      expect(syncSynonyms).toHaveBeenCalledTimes(1);
      expect(syncSynonyms).toHaveBeenLastCalledWith([{ id: created.id, synonyms: ["tieu chay", "di ngoai"] }]);
    });

    it("pushes after deleting an approved group, and not after deleting a pending one", async () => {
      const approved = await service.create({ actorId: SUBMITTER, terms: TERMS });
      await service.approve({ actorId: REVIEWER, id: approved.id, version: 1 });
      const pending = await service.create({ actorId: SUBMITTER, terms: ["ho", "ho khan"] });
      await service.pushesSettled();
      expect(syncSynonyms).toHaveBeenCalledTimes(1);

      await service.delete({ id: pending.id });
      await service.pushesSettled();
      expect(syncSynonyms).toHaveBeenCalledTimes(1);

      await service.delete({ id: approved.id });
      await service.pushesSettled();
      expect(syncSynonyms).toHaveBeenCalledTimes(2);
      expect(syncSynonyms).toHaveBeenLastCalledWith([]);
    });

    it("pushes after editing an approved group, and not after creating or editing a pending one", async () => {
      const created = await service.create({ actorId: SUBMITTER, terms: TERMS });
      await service.pushesSettled();
      expect(syncSynonyms).not.toHaveBeenCalled();

      await service.update({ actorId: SUBMITTER, id: created.id, terms: ["ho", "ho khan"], version: 1 });
      await service.pushesSettled();
      expect(syncSynonyms).not.toHaveBeenCalled();

      await service.approve({ actorId: REVIEWER, id: created.id, version: 2 });
      await service.pushesSettled();
      expect(syncSynonyms).toHaveBeenCalledTimes(1);

      await service.update({ actorId: SUBMITTER, id: created.id, terms: TERMS, version: 3 });
      await service.pushesSettled();
      expect(syncSynonyms).toHaveBeenCalledTimes(2);
      expect(syncSynonyms).toHaveBeenLastCalledWith([]);
    });

    it("logs a failed push and does not reject the change", async () => {
      syncSynonyms.mockRejectedValueOnce(new Error("typesense down"));
      const created = await service.create({ actorId: SUBMITTER, terms: TERMS });

      await expect(service.approve({ actorId: REVIEWER, id: created.id, version: 1 })).resolves.toMatchObject({
        status: "approved",
      });
      await service.pushesSettled();

      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });
});
