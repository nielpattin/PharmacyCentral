import {
  ACTION_PLAN_PATCH_FIELDS,
  type ActionPlanPatchField,
  type ActionPlanStatus,
  type UpdateActionPlanRequest,
} from "../../contracts/action-plans.ts";

const PLATFORM_ADMIN = "Platform Admin";
const PHARMACY_MANAGER = "Pharmacy Manager";

/** Who is calling: the verified employee's id and roles, or a service acting for itself (no employee). */
export type PlanActor = { id: string | undefined; roles: readonly string[]; system: boolean };

/** The part of a plan the permission and site rules read. */
export type PlanOwnership = { ownerId: string; siteId: string | null };

/** An active employee as identity-service describes them, for the owner check. */
export type PlanOwnerCandidate = { roles: readonly string[]; siteIds: readonly string[] };

/** A calendar day in the form `YYYY-MM-DD`, with the day checked against the calendar (no February 31). */
export const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/**
 * A plan's due date is a real calendar day that is today or later. Both sides are `YYYY-MM-DD`, so a text comparison
 * is a date comparison.
 */
export const isAllowedDueDate = (dueDate: string, today: string): boolean =>
  isCalendarDate(dueDate) && dueDate >= today;

/**
 * The completion time after a status change. Entering `done` stamps the time; a plan already done keeps its stamp;
 * leaving `done` clears it. A move between the two open statuses leaves the stamp as it is (null).
 */
export const completedAtAfter = (
  from: string,
  to: ActionPlanStatus,
  completedAt: Date | null,
  now: Date,
): Date | null => {
  if (to !== "done") return null;
  if (from === "done") return completedAt ?? now;
  return now;
};

/** The columns one `PATCH` writes, computed from the current plan and the request. */
export type ActionPlanChanges = {
  status?: ActionPlanStatus;
  completedAt?: Date | null;
  ownerId?: string;
  dueDate?: string;
  title?: string;
  detail?: string | null;
};

/**
 * Turns a validated `PATCH` body into the columns to write. Any status, including the current one, is accepted: a move
 * to the status a plan already has changes nothing, and `completedAt` is only recomputed on a real status change.
 */
export const planChanges = (
  current: { status: string; completedAt: Date | null },
  patch: UpdateActionPlanRequest,
  now: Date,
): ActionPlanChanges => {
  const changes: ActionPlanChanges = {};
  if (patch.status !== undefined) {
    changes.status = patch.status;
    changes.completedAt = completedAtAfter(current.status, patch.status, current.completedAt, now);
  }
  if (patch.ownerId !== undefined) changes.ownerId = patch.ownerId;
  if (patch.dueDate !== undefined) changes.dueDate = patch.dueDate;
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.detail !== undefined) changes.detail = patch.detail;
  return changes;
};

/** The fields a `PATCH` names, in the order `ACTION_PLAN_PATCH_FIELDS` lists them. */
export const changedPlanFields = (patch: UpdateActionPlanRequest): ActionPlanPatchField[] =>
  ACTION_PLAN_PATCH_FIELDS.filter((field) => patch[field] !== undefined);

/** A Platform Admin or Pharmacy Manager, or a service acting for itself: may create plans and reassign them. */
export const managesPlans = (actor: PlanActor): boolean =>
  actor.system || actor.roles.includes(PLATFORM_ADMIN) || actor.roles.includes(PHARMACY_MANAGER);

/**
 * Which plans a caller reads: every plan for Platform Admin and a service; the plans in the caller's sites for a
 * Pharmacy Manager; the plans the caller owns for everyone else. Undefined when an employee without an id asks for
 * a personal list, which the route refuses.
 */
export type PlanReadScope = { kind: "all" } | { kind: "sites" } | { kind: "owner"; ownerId: string };

export const planReadScope = (actor: PlanActor): PlanReadScope | undefined => {
  if (actor.system || actor.roles.includes(PLATFORM_ADMIN)) return { kind: "all" };
  if (actor.roles.includes(PHARMACY_MANAGER)) return { kind: "sites" };
  return actor.id === undefined ? undefined : { kind: "owner", ownerId: actor.id };
};

/**
 * What the caller may change on one plan (BR-PLAN-001): `status` for the plan's owner moving their own plan, `reassign`
 * for a Pharmacy Manager or Platform Admin changing the owner, due date and title and no other field, `all` for a
 * service acting for itself, `refuse` for everyone else and for any caller who names a field outside their right. The
 * status and detail belong to the owner and the system; a manager assigns, the owner works the plan.
 */
export type PlanPatchAccess = "all" | "status" | "reassign" | "refuse";

const REASSIGN_FIELDS: readonly ActionPlanPatchField[] = ["ownerId", "dueDate", "title"];

export const planPatchAccess = (
  actor: PlanActor,
  plan: Pick<PlanOwnership, "ownerId">,
  fields: readonly ActionPlanPatchField[],
): PlanPatchAccess => {
  if (actor.system) return "all";
  if (fields.length === 0) return "refuse";
  if (actor.id !== undefined && actor.id === plan.ownerId && fields.every((field) => field === "status"))
    return "status";
  if (managesPlans(actor) && fields.every((field) => REASSIGN_FIELDS.includes(field))) return "reassign";
  return "refuse";
};

/**
 * An owner must hold the plan's site. A plan with no site needs no site, and a Platform Admin holds every site.
 */
export const ownerCoversSite = (owner: PlanOwnerCandidate, siteId: string | null): boolean =>
  siteId === null || owner.roles.includes(PLATFORM_ADMIN) || owner.siteIds.includes(siteId);
