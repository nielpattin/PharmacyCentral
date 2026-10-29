import type { Logger } from "../../logger.ts";
import type { AuditRecorder } from "../audit/audit-recorder.ts";
import type { ReplenishmentSuggestion } from "../replenishment-suggestions.ts";
import { addDays, expiryWindows, type StockHealthRow } from "../stock-health.ts";

import { ActionPlanConflictError, sourceKey, type ActionPlanRepository } from "./action-plan-repository.ts";
import {
  deadStockAlerts,
  expiryAlerts,
  priceWarningAlerts,
  replenishmentAlerts,
  type ExpiringBatchRow,
  type ListedProduct,
  type PlanAlert,
} from "./auto-plan-alerts.ts";
import { pickPlanOwner } from "./auto-plan-owner.ts";
import type { ActiveEmployee, SiteEmployeeDirectory } from "./identity-employee-client.ts";

/** A plan the system creates is due this many days from the day it is created (BR-PLAN-001). */
export const AUTO_PLAN_DUE_DAYS = 7;

/** A plan completed in the last days is not replaced by a new automatic plan while its alert is still raised. */
export const AUTO_PLAN_COOLDOWN_DAYS = 7;

/** A batch is an expiry alert when it expires within this many days, or already has (as the staff-web button has it). */
export const EXPIRY_ALERT_DAYS = 30;

/** The creator recorded on a plan nobody created by hand. Not an account in identity-service. */
export const SYSTEM_CREATOR_ID = "00000000-0000-0000-0000-000000000000";

const DAY_MS = 86_400_000;

/** Where the alerts come from. Each answer is the live state of the owning data, read at call time. */
export type AutoPlanSources = {
  stockHealth(now: Date): Promise<StockHealthRow[]>;
  expiringBatches(through: string): Promise<ExpiringBatchRow[]>;
  replenishmentSuggestions(siteId: string, now: Date): Promise<ReplenishmentSuggestion[]>;
  listProducts(): Promise<ListedProduct[]>;
};

export type AutoPlanRunResult = {
  /** Alerts raised right now, with or without a plan. */
  alerts: number;
  created: number;
  /** Alerts that needed a plan but whose site has no active Pharmacist or Pharmacy Manager. */
  withoutOwner: number;
};

/**
 * Creates the action plans nobody has to ask for (BR-PLAN-001). One run reads every alert, skips the origins that
 * already have a live plan (or a plan completed inside the cooldown), picks an owner for each remaining alert at its
 * site and inserts the plan. The live-source unique index makes a second or a concurrent run harmless: the same alert
 * never gets two live plans, and a run that loses the race just moves on.
 */
export class ActionPlanAutoCreator {
  public constructor(
    private readonly sources: AutoPlanSources,
    private readonly plans: ActionPlanRepository,
    private readonly employees: SiteEmployeeDirectory,
    private readonly audit: AuditRecorder | undefined,
    private readonly logger: Logger,
  ) {}

  public async run(now: Date = new Date()): Promise<AutoPlanRunResult> {
    const alerts = await this.collectAlerts(now);
    const blocked = await this.plans.blockedSources(new Date(now.getTime() - AUTO_PLAN_COOLDOWN_DAYS * DAY_MS));
    const pending = alerts.filter((alert) => !blocked.has(sourceKey(alert.sourceType, alert.sourceRef)));
    const dueDate = addDays(now.toISOString().slice(0, 10), AUTO_PLAN_DUE_DAYS);
    const candidatesBySite = new Map<string, ActiveEmployee[]>();
    const openCounts = new Map<string, number>();
    const result: AutoPlanRunResult = { alerts: alerts.length, created: 0, withoutOwner: 0 };

    for (const alert of pending) {
      let candidates = candidatesBySite.get(alert.siteId);
      if (!candidates) {
        candidates = await this.employees.listActiveEmployeesAtSite(alert.siteId);
        candidatesBySite.set(alert.siteId, candidates);
        for (const [ownerId, count] of await this.plans.openPlanCounts(candidates.map((employee) => employee.id))) {
          openCounts.set(ownerId, count);
        }
      }
      const owner = pickPlanOwner(candidates, openCounts);
      if (!owner) {
        result.withoutOwner += 1;
        continue;
      }
      try {
        const plan = await this.plans.createActionPlan({
          sourceType: alert.sourceType,
          sourceRef: alert.sourceRef,
          title: alert.title,
          detail: alert.detail,
          siteId: alert.siteId,
          productId: alert.productId,
          ownerId: owner.id,
          dueDate,
          status: "open",
          createdBy: SYSTEM_CREATOR_ID,
        });
        openCounts.set(owner.id, (openCounts.get(owner.id) ?? 0) + 1);
        result.created += 1;
        await this.audit?.record({
          action: "inventory.action-plan.created",
          entityType: "action-plan",
          entityId: plan.id,
          siteId: alert.siteId,
          details: { sourceType: alert.sourceType, automatic: true },
        });
      } catch (error) {
        // Another run or a manager created it first: the origin has its live plan, which is all this run wanted.
        if (!(error instanceof ActionPlanConflictError)) throw error;
      }
    }
    if (result.withoutOwner > 0) {
      this.logger.warn({ withoutOwner: result.withoutOwner }, "alerts at sites with no Pharmacist or Pharmacy Manager");
    }
    return result;
  }

  /** Every alert raised now, in a stable order so the same data always hands out the same owners. */
  private async collectAlerts(now: Date): Promise<PlanAlert[]> {
    const windows = expiryWindows(now);
    const [health, products, batches] = await Promise.all([
      this.sources.stockHealth(now),
      this.sources.listProducts(),
      this.sources.expiringBatches(addDays(windows.today, EXPIRY_ALERT_DAYS)),
    ]);
    const names = new Map(products.map((product) => [product.productId, product.productName]));
    const siteIds = [...new Set(health.map((row) => row.siteId))].sort();
    const replenishment: PlanAlert[] = [];
    for (const siteId of siteIds) {
      replenishment.push(
        ...replenishmentAlerts(siteId, await this.sources.replenishmentSuggestions(siteId, now), names),
      );
    }
    return [
      ...replenishment,
      ...expiryAlerts(batches, windows.today, names),
      ...deadStockAlerts(health, now, names),
      ...priceWarningAlerts(health, products),
    ].sort((a, b) => a.sourceType.localeCompare(b.sourceType) || a.sourceRef.localeCompare(b.sourceRef));
  }
}
