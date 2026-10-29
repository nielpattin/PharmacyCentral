import { and, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import type { ActionPlanSourceType, ActionPlanStatus } from "../../contracts/action-plans.ts";
import type { InventoryDatabase } from "../../shared/infrastructure/database.ts";
import { actionPlans } from "../../shared/infrastructure/schema.ts";
import { afterCursor, presentConditions, splitPage, timestampSortValue } from "../keyset-page.ts";
import { containsPattern, everything, type PageRequest } from "../page-cursor.ts";

import type { ActionPlanChanges } from "./action-plan.ts";

export type ActionPlan = typeof actionPlans.$inferSelect;
export type NewActionPlan = Omit<typeof actionPlans.$inferInsert, "sourceType"> & {
  sourceType: ActionPlanSourceType;
};

export type ActionPlanFilters = {
  /** Plans at these sites only. A plan with no site never matches a site list; undefined means no site restriction. */
  siteIds?: readonly string[] | undefined;
  ownerId?: string | undefined;
  status?: ActionPlanStatus | undefined;
  sourceType?: ActionPlanSourceType | undefined;
  /** A case-insensitive text match on the title. */
  q?: string | undefined;
};

/** The partial unique index that lets one open or in-progress plan exist per origin. */
const LIVE_SOURCE_INDEX = "action_plans_live_source_unique";

/** One origin as a map key. */
export const sourceKey = (sourceType: string, sourceRef: string): string => `${sourceType}|${sourceRef}`;

/** Another open or in-progress plan already exists for the same origin; `planId` is that plan. */
export class ActionPlanConflictError extends Error {
  public constructor(public readonly planId: string) {
    super("An open action plan already exists for this source");
    this.name = "ActionPlanConflictError";
  }
}

const actionPlanFilters = (filters: ActionPlanFilters): Array<SQL | undefined> => [
  filters.siteIds
    ? filters.siteIds.length > 0
      ? inArray(actionPlans.siteId, [...filters.siteIds])
      : sql`false`
    : undefined,
  filters.ownerId ? eq(actionPlans.ownerId, filters.ownerId) : undefined,
  filters.status ? eq(actionPlans.status, filters.status) : undefined,
  filters.sourceType ? eq(actionPlans.sourceType, filters.sourceType) : undefined,
  filters.q ? ilike(actionPlans.title, containsPattern(filters.q)) : undefined,
];

/** The unique violation of the live-source index, read through drizzle's wrapper and the driver's error. */
const isLiveSourceViolation = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const { code, constraint, cause } = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (code === "23505") return constraint === LIVE_SOURCE_INDEX;
    current = cause;
  }
  return false;
};

export class ActionPlanRepository {
  public constructor(private readonly database: InventoryDatabase) {}

  /** Plans newest first, one keyset page at a time. */
  public async listActionPlans(filters: ActionPlanFilters = {}, page: PageRequest = everything) {
    const conditions = presentConditions([
      ...actionPlanFilters(filters),
      afterCursor({
        sortColumn: actionPlans.createdAt,
        idColumn: actionPlans.id,
        direction: "desc",
        kind: "timestamp",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({ plan: actionPlans, id: actionPlans.id, sortValue: timestampSortValue(actionPlans.createdAt) })
      .from(actionPlans)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(actionPlans.createdAt), desc(actionPlans.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    return { rows: items.map(({ plan }) => plan), nextCursor };
  }

  public async findActionPlan(id: string): Promise<ActionPlan | undefined> {
    const [plan] = await this.database.db.select().from(actionPlans).where(eq(actionPlans.id, id)).limit(1);
    return plan;
  }

  /**
   * The origins that must not get an automatic plan: those with a plan still open or in progress, and those whose plan
   * was completed at or after `completedSince` (a finished plan is not recreated at once while its alert persists).
   */
  public async blockedSources(completedSince: Date): Promise<Set<string>> {
    const rows = await this.database.db
      .select({ sourceType: actionPlans.sourceType, sourceRef: actionPlans.sourceRef })
      .from(actionPlans)
      .where(or(sql`${actionPlans.status} <> 'done'`, gte(actionPlans.completedAt, completedSince)));
    return new Set(rows.map((row) => sourceKey(row.sourceType, row.sourceRef)));
  }

  /** Open and in-progress plans per owner, for the owners named; an owner with none is absent from the map. */
  public async openPlanCounts(ownerIds: readonly string[]): Promise<Map<string, number>> {
    if (ownerIds.length === 0) return new Map();
    const rows = await this.database.db
      .select({ ownerId: actionPlans.ownerId, count: sql<number>`count(*)::int` })
      .from(actionPlans)
      .where(and(inArray(actionPlans.ownerId, [...ownerIds]), sql`${actionPlans.status} <> 'done'`))
      .groupBy(actionPlans.ownerId);
    return new Map(rows.map((row) => [row.ownerId, row.count]));
  }

  /** The open or in-progress plan for an origin, other than `exceptId`; the conflict check reads it after a violation. */
  private async liveSourcePlanId(
    sourceType: string,
    sourceRef: string,
    exceptId: string | undefined,
  ): Promise<string | undefined> {
    const [row] = await this.database.db
      .select({ id: actionPlans.id })
      .from(actionPlans)
      .where(
        and(
          eq(actionPlans.sourceType, sourceType),
          eq(actionPlans.sourceRef, sourceRef),
          sql`${actionPlans.status} <> 'done'`,
          exceptId ? sql`${actionPlans.id} <> ${exceptId}::uuid` : undefined,
        ),
      )
      .limit(1);
    return row?.id;
  }

  /** Inserts a plan. A second live plan for the same origin fails with `ActionPlanConflictError`. */
  public async createActionPlan(input: NewActionPlan): Promise<ActionPlan> {
    try {
      const [plan] = await this.database.db.insert(actionPlans).values(input).returning();
      if (!plan) throw new Error("Action plan insert returned no row");
      return plan;
    } catch (error) {
      throw await this.conflictOr(error, input.sourceType, input.sourceRef, undefined);
    }
  }

  /**
   * Writes the changes of one plan and stamps `updatedAt`. Reopening a done plan whose origin now has a live plan fails
   * with `ActionPlanConflictError`. Returns undefined when no plan has the id.
   */
  public async updateActionPlan(id: string, changes: ActionPlanChanges, now: Date): Promise<ActionPlan | undefined> {
    try {
      const [plan] = await this.database.db
        .update(actionPlans)
        .set({ ...changes, updatedAt: now })
        .where(eq(actionPlans.id, id))
        .returning();
      return plan;
    } catch (error) {
      const current = await this.findActionPlan(id);
      if (!current) throw error;
      throw await this.conflictOr(error, current.sourceType, current.sourceRef, id);
    }
  }

  /** The conflict error when the live-source index refused the write; any other failure is rethrown unchanged. */
  private async conflictOr(
    error: unknown,
    sourceType: string,
    sourceRef: string,
    exceptId: string | undefined,
  ): Promise<unknown> {
    if (!isLiveSourceViolation(error)) return error;
    const planId = await this.liveSourcePlanId(sourceType, sourceRef, exceptId);
    return planId === undefined ? error : new ActionPlanConflictError(planId);
  }
}
