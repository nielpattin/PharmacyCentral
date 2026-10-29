import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "../../logger.ts";
import type { InventoryDatabase } from "../../shared/infrastructure/database.ts";
import * as schema from "../../shared/infrastructure/schema.ts";
import type { AuditEntry } from "../audit/audit-recorder.ts";
import type { ReplenishmentSuggestion } from "../replenishment-suggestions.ts";
import type { StockHealthRow } from "../stock-health.ts";

import {
  ActionPlanAutoCreator,
  AUTO_PLAN_COOLDOWN_DAYS,
  SYSTEM_CREATOR_ID,
  type AutoPlanSources,
} from "./action-plan-auto-creator.ts";
import { ActionPlanRepository } from "./action-plan-repository.ts";
import type { ExpiringBatchRow } from "./auto-plan-alerts.ts";
import type { ActiveEmployee } from "./identity-employee-client.ts";

const migrationsFolder = fileURLToPath(new URL("../../../drizzle/migrations", import.meta.url));
const idOf = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const siteA = idOf(0xa);
const siteB = idOf(0xb);
const NOW = new Date("2026-10-29T03:00:00Z");

const employee = (n: number, displayName: string, role: string, siteIds: string[]): ActiveEmployee => ({
  id: idOf(n),
  displayName,
  roles: [role],
  siteIds,
});
const lan = employee(1, "Phạm Thị Lan", "Pharmacist", [siteA]);
const chau = employee(2, "Lê Minh Châu", "Pharmacist", [siteA]);
const managerA = employee(3, "Quản lý A", "Pharmacy Manager", [siteA]);
const managerB = employee(4, "Quản lý B", "Pharmacy Manager", [siteB]);

const healthRow = (overrides: Partial<StockHealthRow>): StockHealthRow => ({
  siteId: siteA,
  productId: idOf(0x100),
  onHand: 5,
  reserved: 0,
  dispensed: 1,
  netChange: 0,
  lastMovementAt: NOW.toISOString(),
  expired: 0,
  expiring30: 0,
  expiring60: 0,
  expiring90: 0,
  ...overrides,
});

const suggestion = (productId: string): ReplenishmentSuggestion =>
  ({ productId, suggestedQuantity: 40 }) as ReplenishmentSuggestion;

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as Logger;

describe("ActionPlanAutoCreator", () => {
  const db = { client: undefined as PGlite | undefined, plans: undefined as ActionPlanRepository | undefined };
  let sources: AutoPlanSources;
  let staff: ActiveEmployee[];
  let audit: AuditEntry[];
  let creator: ActionPlanAutoCreator;

  const plans = (): ActionPlanRepository => {
    if (!db.plans) throw new Error("database not ready");
    return db.plans;
  };

  beforeAll(async () => {
    const client = new PGlite();
    const drizzled = drizzle({ client, schema });
    await migrate(drizzled, { migrationsFolder });
    db.client = client;
    db.plans = new ActionPlanRepository({ db: drizzled, pool: undefined } as unknown as InventoryDatabase);
  });
  afterAll(async () => {
    await db.client?.close();
  });

  beforeEach(async () => {
    await db.client?.exec("delete from action_plans");
    staff = [lan, chau, managerA, managerB];
    audit = [];
    sources = {
      stockHealth: async () => [],
      expiringBatches: async () => [],
      replenishmentSuggestions: async () => [],
      listProducts: async () => [],
    };
    creator = new ActionPlanAutoCreator(
      {
        stockHealth: (now) => sources.stockHealth(now),
        expiringBatches: (through) => sources.expiringBatches(through),
        replenishmentSuggestions: (siteId, now) => sources.replenishmentSuggestions(siteId, now),
        listProducts: () => sources.listProducts(),
      },
      plans(),
      { listActiveEmployeesAtSite: async (siteId) => staff.filter((member) => member.siteIds.includes(siteId)) },
      { record: async (entry) => void audit.push(entry) },
      logger,
    );
  });

  const allPlans = async () => (await plans().listActionPlans()).rows;

  it("creates a plan for each alert type, due in 7 days, owned by a Pharmacist of the plan's site", async () => {
    const product = idOf(0x100);
    const batch: ExpiringBatchRow = {
      siteId: siteA,
      batchId: idOf(0x300),
      productId: product,
      batchNumber: "LO-1",
      expiryDate: "2026-11-10",
      quantityOnHand: 12,
    };
    sources.stockHealth = async () => [
      healthRow({ productId: product, onHand: 3, lastMovementAt: "2026-05-01T00:00:00Z" }),
    ];
    sources.replenishmentSuggestions = async (siteId) => (siteId === siteA ? [suggestion(product)] : []);
    sources.expiringBatches = async () => [batch];
    sources.listProducts = async () => [{ productId: product, productName: "Thuốc A", unitPrice: null }];

    const result = await creator.run(NOW);

    expect(result).toEqual({ alerts: 4, created: 4, withoutOwner: 0 });
    const created = await allPlans();
    expect(created.map((plan) => plan.sourceType).sort()).toEqual([
      "dead_stock",
      "expiry",
      "price_warning",
      "replenishment",
    ]);
    for (const plan of created) {
      expect([lan.id, chau.id]).toContain(plan.ownerId);
      expect(plan).toMatchObject({
        siteId: siteA,
        status: "open",
        dueDate: "2026-11-05",
        createdBy: SYSTEM_CREATOR_ID,
      });
    }
    expect(audit).toHaveLength(4);
    expect(audit[0]).toMatchObject({ action: "inventory.action-plan.created", details: { automatic: true } });
    expect(audit[0]?.actorId).toBeUndefined();
  });

  it("hands each new plan to the Pharmacist with the fewest open plans, counting the plans of this run", async () => {
    const products = [0x101, 0x102, 0x103, 0x104].map(idOf);
    sources.stockHealth = async () => [healthRow({ productId: products[0]! })];
    sources.replenishmentSuggestions = async () => products.map(suggestion);
    // Lan already holds one live plan, so Châu takes the first new one; each pick then counts the plans handed out
    // before it (Châu 1, Lan 1: tie, Châu by name; Châu 2, Lan 1: Lan; Châu 2, Lan 2: tie, Châu).
    await plans().createActionPlan({
      sourceType: "expiry",
      sourceRef: "expiry:manual",
      title: "Việc cũ",
      siteId: siteA,
      ownerId: lan.id,
      dueDate: "2026-11-05",
      status: "in_progress",
      createdBy: idOf(0x9),
    });

    await creator.run(NOW);

    const owners = (await allPlans()).filter((plan) => plan.sourceType === "replenishment").map((plan) => plan.ownerId);
    expect(owners.filter((id) => id === chau.id)).toHaveLength(3);
    expect(owners.filter((id) => id === lan.id)).toHaveLength(1);
  });

  it("gives an alert to the site's Pharmacy Manager when the site has no Pharmacist", async () => {
    sources.stockHealth = async () => [healthRow({ siteId: siteB })];
    sources.replenishmentSuggestions = async (siteId) => (siteId === siteB ? [suggestion(idOf(0x100))] : []);

    const result = await creator.run(NOW);

    expect(result.created).toBe(1);
    expect((await allPlans())[0]?.ownerId).toBe(managerB.id);
  });

  it("creates no plan, and reports it, for a site with neither a Pharmacist nor a Pharmacy Manager", async () => {
    staff = [lan];
    sources.stockHealth = async () => [healthRow({ siteId: siteB })];
    sources.replenishmentSuggestions = async () => [suggestion(idOf(0x100))];

    const result = await creator.run(NOW);

    expect(result).toMatchObject({ created: 0, withoutOwner: 1 });
    expect(await allPlans()).toHaveLength(0);
  });

  it("creates nothing new on a second run, and never a second live plan for one alert", async () => {
    sources.stockHealth = async () => [healthRow({})];
    sources.replenishmentSuggestions = async () => [suggestion(idOf(0x100)), suggestion(idOf(0x101))];

    expect((await creator.run(NOW)).created).toBe(2);
    expect((await creator.run(NOW)).created).toBe(0);
    expect(await allPlans()).toHaveLength(2);
  });

  it("is safe when two runs overlap", async () => {
    sources.stockHealth = async () => [healthRow({})];
    sources.replenishmentSuggestions = async () => [suggestion(idOf(0x100))];

    await Promise.all([creator.run(NOW), creator.run(NOW)]);

    expect(await allPlans()).toHaveLength(1);
  });

  it("skips an alert a manager already made a plan for, whatever the owner", async () => {
    const product = idOf(0x100);
    sources.stockHealth = async () => [healthRow({})];
    sources.replenishmentSuggestions = async () => [suggestion(product)];
    await plans().createActionPlan({
      sourceType: "replenishment",
      sourceRef: `replenishment:${siteA}:${product}`,
      title: "Do quản lý tạo",
      siteId: siteA,
      ownerId: managerA.id,
      dueDate: "2026-11-05",
      status: "open",
      createdBy: managerA.id,
    });

    expect((await creator.run(NOW)).created).toBe(0);
    expect(await allPlans()).toHaveLength(1);
  });

  it("waits out the cooldown after a plan is done, then makes a new plan if the alert is still raised", async () => {
    sources.stockHealth = async () => [healthRow({})];
    sources.replenishmentSuggestions = async () => [suggestion(idOf(0x100))];
    await creator.run(NOW);
    const [first] = await allPlans();
    await plans().updateActionPlan(first!.id, { status: "done", completedAt: NOW }, NOW);

    expect((await creator.run(new Date(NOW.getTime() + 86_400_000))).created).toBe(0);
    const afterCooldown = new Date(NOW.getTime() + (AUTO_PLAN_COOLDOWN_DAYS + 1) * 86_400_000);
    expect((await creator.run(afterCooldown)).created).toBe(1);
    expect(await allPlans()).toHaveLength(2);
  });

  it("raises dead stock only for stock on hand with no movement in 90 days, and no alert for stock that moved", async () => {
    sources.stockHealth = async () => [
      healthRow({ productId: idOf(0x101), lastMovementAt: "2026-07-01T00:00:00Z" }),
      healthRow({ productId: idOf(0x102), lastMovementAt: null }),
      healthRow({ productId: idOf(0x103), lastMovementAt: "2026-10-20T00:00:00Z" }),
      healthRow({ productId: idOf(0x104), onHand: 0, lastMovementAt: "2026-01-01T00:00:00Z" }),
    ];

    await creator.run(NOW);

    expect((await allPlans()).map((plan) => plan.productId).sort()).toEqual([idOf(0x101), idOf(0x102)]);
  });

  it("files a price warning once for a product held at two sites, at the site with the most stock", async () => {
    const product = idOf(0x100);
    sources.stockHealth = async () => [
      healthRow({ siteId: siteA, productId: product, onHand: 2 }),
      healthRow({ siteId: siteB, productId: product, onHand: 9 }),
    ];
    sources.listProducts = async () => [{ productId: product, productName: "Thuốc A", unitPrice: null }];

    await creator.run(NOW);

    const warnings = (await allPlans()).filter((plan) => plan.sourceType === "price_warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ siteId: siteB, ownerId: managerB.id });
  });

  it("fails the whole run, creating nothing, when a source is unavailable", async () => {
    sources.stockHealth = async () => {
      throw new Error("catalog down");
    };

    await expect(creator.run(NOW)).rejects.toThrow("catalog down");
    expect(await allPlans()).toHaveLength(0);
  });
});
