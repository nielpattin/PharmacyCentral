import { isActionPlanStatus, type ActionPlan } from "./contract.ts";

/**
 * The URL-held filters of the list. `plan` names one plan to show on its own (the target of a "plan already exists"
 * answer); empty shows every plan.
 */
export const ACTION_PLAN_LIST_DEFAULTS = { q: "", status: "all", owner: "all", plan: "" } as const;

export type ActionPlanListFilters = { q: string; status: string; owner: string };

/**
 * The query params of `GET /api/inventory/action-plans`. An owner filter is sent only when the viewer may use it
 * (`ownerFilter`), so an owner the URL names for another role is dropped rather than sent.
 */
export const actionPlanListParams = (
  filters: ActionPlanListFilters,
  ownerFilter: boolean,
): Record<string, string | undefined> => ({
  ownerId: ownerFilter && filters.owner !== "all" ? filters.owner : undefined,
  status: isActionPlanStatus(filters.status) ? filters.status : undefined,
  q: filters.q.trim() || undefined,
});

/** The rows to show: every loaded plan, or only the one named by `planId`. */
export const visiblePlans = (plans: readonly ActionPlan[], planId: string): ActionPlan[] =>
  planId === "" ? [...plans] : plans.filter((plan) => plan.id === planId);
