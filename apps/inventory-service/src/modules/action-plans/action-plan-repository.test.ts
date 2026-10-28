import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InventoryDatabase } from "../../shared/infrastructure/database.ts";
import * as schema from "../../shared/infrastructure/schema.ts";
import { decodePageCursor } from "../page-cursor.ts";

import { ActionPlanConflictError, ActionPlanRepository, type NewActionPlan } from "./action-plan-repository.ts";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle/migrations", import.meta.url));
const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const siteA = idOf(0xa);
const siteB = idOf(0xb);
const ownerOne = idOf(0x1);
const ownerTwo = idOf(0x2);
const creator = idOf(0x3);
const UPDATED = new Date("2026-10-28T10:00:00Z");

/** One plan with its own id and a creation time the test sets, so the newest-first order is exact. */
const plan = (n: number, overrides: Partial<NewActionPlan> & { createdAt: Date }): NewActionPlan => ({
  id: idOf(0x100 + n),
  sourceType: "replenishment",
  sourceRef: `replenishment:${siteA}:${idOf(0x200 + n)}`,
  title: `Việc ${n}`,
  siteId: siteA,
  ownerId: ownerOne,
  dueDate: "2026-11-05",
  status: "open",
  createdBy: creator,
  ...overrides,
});

/** A database of its own: the real migrations on an in-memory PGlite, so each suite sees only its own rows. */
const freshDatabase = async () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  const repository = new ActionPlanRepository({ db, pool: undefined } as unknown as InventoryDatabase);
  return { client, repository };
};

describe("ActionPlanRepository live source uniqueness", () => {
  const database = {
    client: undefined as PGlite | undefined,
    repository: undefined as ActionPlanRepository | undefined,
  };

  beforeAll(async () => {
    const fresh = await freshDatabase();
    database.client = fresh.client;
    database.repository = fresh.repository;
  });

  afterAll(async () => {
    await database.client?.close();
  });

  const repo = () => {
    if (!database.repository) throw new Error("repository not ready");
    return database.repository;
  };

  it("refuses a second open plan for the same origin and names the plan that exists", async () => {
    const first = await repo().createActionPlan(plan(1, { createdAt: new Date("2026-10-01T01:00:00Z") }));
    const sameOrigin = { sourceRef: first.sourceRef, createdAt: new Date("2026-10-01T01:00:00Z") };
    await expect(repo().createActionPlan(plan(2, sameOrigin))).rejects.toMatchObject({
      planId: first.id,
      name: "ActionPlanConflictError",
    });
  });

  it("refuses an in-progress plan for an origin that already has a live one", async () => {
    const first = await repo().findActionPlan(idOf(0x101));
    const attempt = repo().createActionPlan(
      plan(3, {
        sourceRef: first?.sourceRef ?? "",
        createdAt: new Date("2026-10-01T01:00:00Z"),
        status: "in_progress",
      }),
    );
    await expect(attempt).rejects.toBeInstanceOf(ActionPlanConflictError);
  });

  it("allows the same origin under another source type", async () => {
    const first = await repo().findActionPlan(idOf(0x101));
    const other = await repo().createActionPlan(
      plan(4, {
        sourceType: "dead_stock",
        sourceRef: first?.sourceRef ?? "",
        createdAt: new Date("2026-10-01T01:00:00Z"),
      }),
    );
    expect(other.sourceType).toBe("dead_stock");
  });

  it("lets a new plan follow a done one, and refuses the reopen of the done one while the new plan is live", async () => {
    const done = await repo().createActionPlan(
      plan(5, {
        sourceType: "price_warning",
        sourceRef: "price_warning:p-1",
        createdAt: new Date("2026-10-01T02:00:00Z"),
        status: "done",
      }),
    );
    const live = await repo().createActionPlan(
      plan(6, {
        sourceType: "price_warning",
        sourceRef: "price_warning:p-1",
        createdAt: new Date("2026-10-01T03:00:00Z"),
      }),
    );
    await expect(
      repo().updateActionPlan(done.id, { status: "open", completedAt: null }, UPDATED),
    ).rejects.toMatchObject({
      planId: live.id,
    });
    // The refused reopen left the done plan as it was.
    expect((await repo().findActionPlan(done.id))?.status).toBe("done");
  });

  it("writes the given columns, stamps updatedAt, and returns undefined for an unknown plan", async () => {
    const created = await repo().createActionPlan(
      plan(7, { sourceType: "expiry", sourceRef: "expiry:x:y", createdAt: new Date("2026-10-02T00:00:00Z") }),
    );
    const completedAt = new Date("2026-10-28T11:00:00Z");
    const updated = await repo().updateActionPlan(
      created.id,
      { status: "done", completedAt, title: "Đã xử lý" },
      UPDATED,
    );
    expect(updated).toMatchObject({ status: "done", title: "Đã xử lý" });
    expect(updated?.completedAt?.toISOString()).toBe(completedAt.toISOString());
    expect(updated?.updatedAt.toISOString()).toBe(UPDATED.toISOString());
    expect(updated?.createdAt.toISOString()).toBe(created.createdAt.toISOString());

    // Reopening clears the stamp.
    const reopened = await repo().updateActionPlan(created.id, { status: "in_progress", completedAt: null }, UPDATED);
    expect(reopened).toMatchObject({ status: "in_progress", completedAt: null });

    expect(await repo().updateActionPlan(idOf(0xdead), { title: "x" }, UPDATED)).toBeUndefined();
  });
});

describe("ActionPlanRepository.listActionPlans", () => {
  const database = {
    client: undefined as PGlite | undefined,
    repository: undefined as ActionPlanRepository | undefined,
  };
  let ids: string[] = [];

  beforeAll(async () => {
    const fresh = await freshDatabase();
    database.client = fresh.client;
    database.repository = fresh.repository;
    const rows: NewActionPlan[] = [
      plan(10, {
        createdAt: new Date("2026-09-01T00:00:00Z"),
        title: "Bổ sung Paracetamol",
        siteId: siteA,
        ownerId: ownerOne,
        status: "open",
      }),
      plan(11, {
        createdAt: new Date("2026-09-02T00:00:00Z"),
        title: "Hạn dùng lô 50%",
        siteId: siteA,
        ownerId: ownerTwo,
        status: "in_progress",
        sourceType: "expiry",
        sourceRef: "expiry:a:b",
      }),
      plan(12, {
        createdAt: new Date("2026-09-03T00:00:00Z"),
        title: "Hàng chậm bán",
        siteId: siteB,
        ownerId: ownerOne,
        status: "done",
        sourceType: "dead_stock",
        sourceRef: "dead_stock:b:c",
      }),
      plan(13, {
        createdAt: new Date("2026-09-04T00:00:00Z"),
        title: "Việc không có địa điểm",
        siteId: null,
        ownerId: ownerOne,
        status: "open",
        sourceType: "price_warning",
        sourceRef: "price_warning:p-9",
      }),
      plan(14, {
        createdAt: new Date("2026-09-05T00:00:00Z"),
        title: "Giá bán lệch",
        siteId: siteB,
        ownerId: ownerTwo,
        status: "open",
        sourceType: "price_warning",
        sourceRef: "price_warning:p-10",
      }),
    ];
    for (const row of rows) await fresh.repository.createActionPlan(row);
    ids = rows.map((row) => row.id as string);
  });

  afterAll(async () => {
    await database.client?.close();
  });

  const repo = () => {
    if (!database.repository) throw new Error("repository not ready");
    return database.repository;
  };

  it("returns the plans newest first, with every column", async () => {
    const { rows, nextCursor } = await repo().listActionPlans();
    expect(nextCursor).toBeUndefined();
    expect(rows.map((row) => row.id)).toEqual([...ids].reverse());
    expect(rows[0]).toMatchObject({ dueDate: "2026-11-05", createdBy: creator, status: "open", completedAt: null });
  });

  it("filters by owner, status, source type and the title text", async () => {
    const owned = await repo().listActionPlans({ ownerId: ownerTwo });
    expect(owned.rows.map((row) => row.id)).toEqual([ids[4], ids[1]]);

    const open = await repo().listActionPlans({ status: "open" });
    expect(open.rows.map((row) => row.status)).toEqual(["open", "open", "open"]);

    const priceWarnings = await repo().listActionPlans({ sourceType: "price_warning" });
    expect(priceWarnings.rows.map((row) => row.sourceType)).toEqual(["price_warning", "price_warning"]);

    const text = await repo().listActionPlans({ q: "paracetamol" });
    expect(text.rows.map((row) => row.title)).toEqual(["Bổ sung Paracetamol"]);
  });

  it("takes a percent sign in the search text literally", async () => {
    expect((await repo().listActionPlans({ q: "50%" })).rows.map((row) => row.title)).toEqual(["Hạn dùng lô 50%"]);
    expect((await repo().listActionPlans({ q: "%" })).rows.map((row) => row.title)).toEqual(["Hạn dùng lô 50%"]);
  });

  it("restricts to the plans at the given sites, drops plans with no site, and returns nothing for no sites", async () => {
    const atA = await repo().listActionPlans({ siteIds: [siteA] });
    expect(atA.rows.map((row) => row.id)).toEqual([ids[1], ids[0]]);

    expect((await repo().listActionPlans({ siteIds: [] })).rows).toEqual([]);

    const unrestricted = await repo().listActionPlans({ siteIds: undefined });
    expect(unrestricted.rows.some((row) => row.siteId === null)).toBe(true);
    expect(unrestricted.rows).toHaveLength(5);
  });

  it("pages by the creation time and the id, with no repeated or skipped plan", async () => {
    const first = await repo().listActionPlans({}, { limit: 2, cursor: undefined });
    expect(first.rows.map((row) => row.id)).toEqual([ids[4], ids[3]]);
    expect(first.nextCursor).toBeDefined();

    const second = await repo().listActionPlans(
      {},
      { limit: 2, cursor: decodePageCursor(first.nextCursor ?? "", "timestamp") },
    );
    expect(second.rows.map((row) => row.id)).toEqual([ids[2], ids[1]]);
    expect(second.nextCursor).toBeDefined();

    const last = await repo().listActionPlans(
      {},
      { limit: 2, cursor: decodePageCursor(second.nextCursor ?? "", "timestamp") },
    );
    expect(last.rows.map((row) => row.id)).toEqual([ids[0]]);
    expect(last.nextCursor).toBeUndefined();
  });
});
