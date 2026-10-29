import { translateText } from "../i18n.ts";

/**
 * What each staff action needs before the server answers it, so a control the server would refuse is not offered. The
 * role contract is the role-by-section table in `docs/product/staff-shell-sign-in-and-navigation.md`; the server rules
 * are in `deploy/aws/lambda/policy.mjs`. Platform Admin passes every role list, except `excludesPlatformAdmin` actions.
 */

export const STAFF_ROLES = ["Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** The slice of the signed-in session the rules read. `useSession()` returns it. */
export type PermissionSession = {
  roles?: readonly string[] | undefined;
  userId?: string | undefined;
  /** The sites the employee is assigned to. Platform Admin has no site limit and ignores it. */
  siteIds?: readonly string[] | undefined;
};

/** The creator of a record, for rules that depend on who made it. */
export type RecordOwner = { ownerId: string | undefined };

export type AccessResult = { allowed: true } | { allowed: false; reason: string };

type StaffActionRule = {
  roles: readonly StaffRole[];
  /** English sentence, translated when the result is built. It is also the key of its Vietnamese literal. */
  reason: string;
  /** Platform Admin is refused too: counter work, cash, customer lookup and synonym approval. */
  excludesPlatformAdmin?: true;
  /** The record's creator may not act on it. */
  separationOfDuties?: true;
  separationReason?: string;
  /** The record's creator may act on it in these roles, whatever `roles` says. */
  ownerRoles?: readonly StaffRole[];
};

const pharmacist = ["Pharmacist"] as const;
const manager = ["Pharmacy Manager"] as const;
const warehouse = ["Warehouse Staff"] as const;
const platformAdmin = [] as const;

export const staffActions = {
  "prescription.create": {
    roles: pharmacist,
    excludesPlatformAdmin: true,
    reason: "Only a Pharmacist can create prescriptions.",
  },
  "prescription.dispense": {
    roles: pharmacist,
    excludesPlatformAdmin: true,
    reason: "Only a Pharmacist can dispense prescriptions.",
  },
  "prescription.cancel": {
    roles: pharmacist,
    excludesPlatformAdmin: true,
    reason: "Only a Pharmacist can cancel prescriptions.",
  },
  "prescription.createInvoice": {
    roles: pharmacist,
    excludesPlatformAdmin: true,
    reason: "Only a Pharmacist can create a counter invoice.",
  },
  "consultation.answer": {
    roles: pharmacist,
    excludesPlatformAdmin: true,
    reason: "Only a Pharmacist can answer consultations.",
  },
  "payment.confirmCash": {
    roles: pharmacist,
    excludesPlatformAdmin: true,
    reason: "Only a Pharmacist can confirm cash payments.",
  },
  "payment.refund.counter": {
    roles: pharmacist,
    excludesPlatformAdmin: true,
    reason: "Only a Pharmacist can refund counter payments.",
  },
  "payment.refund": { roles: manager, reason: "Only a Pharmacy Manager can refund payments." },
  "payment.invoices.view": {
    roles: ["Pharmacist", "Pharmacy Manager"],
    reason: "Only a Pharmacist or Pharmacy Manager can view payment invoices.",
  },
  "customer.lookup": {
    roles: pharmacist,
    excludesPlatformAdmin: true,
    reason: "Only a Pharmacist can look up customers.",
  },
  "finance.summary.view": { roles: manager, reason: "Only a Pharmacy Manager can view the finance summary." },
  "price.publish": {
    roles: manager,
    separationOfDuties: true,
    separationReason: "The creator of a price draft cannot publish that draft.",
    reason: "Only a Pharmacy Manager can publish prices.",
  },
  "purchaseOrder.create": { roles: manager, reason: "Only a Pharmacy Manager can create purchase orders." },
  "purchaseOrder.approve": {
    roles: manager,
    separationOfDuties: true,
    reason: "Only a Pharmacy Manager can approve purchase orders.",
  },
  "purchaseOrder.cancel": { roles: manager, reason: "Only a Pharmacy Manager can cancel purchase orders." },
  "replenishment.suggestions.view": {
    roles: manager,
    reason: "Only a Pharmacy Manager can view reorder suggestions.",
  },
  "goodsReceipt.view": { roles: warehouse, reason: "Only Warehouse Staff can view goods receipts." },
  "goodsReceipt.create": { roles: warehouse, reason: "Only Warehouse Staff can receive goods." },
  "inventory.balances.view": {
    roles: ["Pharmacist", "Pharmacy Manager", "Warehouse Staff"],
    reason: "Only a Pharmacist, Pharmacy Manager or Warehouse Staff can view stock balances.",
  },
  "inventory.batches.view": {
    roles: ["Pharmacist", "Pharmacy Manager", "Warehouse Staff"],
    reason: "Only a Pharmacist, Pharmacy Manager or Warehouse Staff can view batches.",
  },
  "inventory.movements.view": {
    roles: ["Pharmacy Manager", "Warehouse Staff"],
    reason: "Only a Pharmacy Manager or Warehouse Staff can view stock movements.",
  },
  "inventory.adjustments.view": {
    roles: ["Pharmacy Manager", "Warehouse Staff"],
    reason: "Only a Pharmacy Manager or Warehouse Staff can view adjustments.",
  },
  "inventory.transfers.view": {
    roles: ["Pharmacy Manager", "Warehouse Staff"],
    reason: "Only a Pharmacy Manager or Warehouse Staff can view transfers.",
  },
  "inventory.stocktake.view": {
    roles: ["Pharmacy Manager", "Warehouse Staff"],
    reason: "Only a Pharmacy Manager or Warehouse Staff can view stocktakes.",
  },
  "inventory.returns.view": {
    roles: ["Pharmacy Manager", "Warehouse Staff"],
    reason: "Only a Pharmacy Manager or Warehouse Staff can view returns and removals.",
  },
  "inventory.batch.create": { roles: warehouse, reason: "Only Warehouse Staff can create batches." },
  "inventory.batch.quality": {
    roles: ["Pharmacist", "Pharmacy Manager"],
    reason: "Only a Pharmacist, Pharmacy Manager or Platform Admin can release or reject batches.",
  },
  "inventory.movement.create": { roles: warehouse, reason: "Only Warehouse Staff can record stock movements." },
  "inventory.adjustment.create": { roles: warehouse, reason: "Only Warehouse Staff can create stock adjustments." },
  "inventory.adjustment.decide": {
    roles: manager,
    separationOfDuties: true,
    reason: "Only a Pharmacy Manager can approve or reject adjustments.",
  },
  "inventory.transfer.create": { roles: warehouse, reason: "Only Warehouse Staff can create transfers." },
  "inventory.transfer.approve": {
    roles: manager,
    separationOfDuties: true,
    reason: "Only a Pharmacy Manager can approve transfers.",
  },
  "inventory.transfer.transition": {
    roles: warehouse,
    reason: "Only Warehouse Staff can ship or receive transfers.",
  },
  "inventory.transfer.cancel": {
    roles: manager,
    ownerRoles: warehouse,
    reason: "Only a Pharmacy Manager or the Warehouse Staff who created it can cancel a transfer.",
  },
  "inventory.stocktake.create": { roles: warehouse, reason: "Only Warehouse Staff can start stocktakes." },
  "inventory.stocktake.count": { roles: warehouse, reason: "Only Warehouse Staff can record stock counts." },
  "inventory.stocktake.post": {
    roles: manager,
    separationOfDuties: true,
    reason: "Only a Pharmacy Manager can post stocktakes.",
  },
  "inventory.return.create": { roles: warehouse, reason: "Only Warehouse Staff can record returns." },
  "replenishment.view": {
    roles: ["Pharmacist", "Pharmacy Manager", "Warehouse Staff"],
    reason: "Only a Pharmacist, Pharmacy Manager or Warehouse Staff can view replenishment requests.",
  },
  "replenishment.create": {
    roles: ["Pharmacist", "Pharmacy Manager"],
    reason: "Only a Pharmacist or Pharmacy Manager can request replenishment.",
  },
  "replenishment.decide": {
    roles: warehouse,
    separationOfDuties: true,
    reason: "Only Warehouse Staff can approve, reject or fulfil replenishment requests.",
  },
  "replenishment.cancel": {
    roles: warehouse,
    ownerRoles: ["Pharmacist", "Pharmacy Manager"],
    reason: "Only Warehouse Staff or the person who requested it can cancel a replenishment request.",
  },
  "actionPlan.create": { roles: manager, reason: "Only a Pharmacy Manager can create action plans." },
  "actionPlan.reassign": { roles: manager, reason: "Only a Pharmacy Manager can reassign an action plan." },
  "catalog.write": { roles: manager, reason: "Only a Pharmacy Manager can change the catalog and master data." },
  "catalog.site.create": { roles: platformAdmin, reason: "Only a Platform Admin can create or delete a site." },
  "catalog.site.delete": { roles: platformAdmin, reason: "Only a Platform Admin can create or delete a site." },
  "catalog.import": {
    roles: manager,
    reason: "Only a Pharmacy Manager can import products, sites, storage locations or suppliers.",
  },
  "stock.import": { roles: warehouse, reason: "Only Warehouse Staff can import opening balances." },
  "synonym.write": {
    roles: ["Pharmacist", "Pharmacy Manager"],
    reason: "Only a Pharmacist or Pharmacy Manager can change search synonyms.",
  },
  "synonym.approve": {
    roles: ["Pharmacist", "Pharmacy Manager"],
    excludesPlatformAdmin: true,
    separationOfDuties: true,
    reason: "Only a Pharmacist or Pharmacy Manager can approve search synonyms.",
  },
  "governance.user.write": { roles: platformAdmin, reason: "Only a Platform Admin can manage staff accounts." },
  "ai.credential.write": { roles: platformAdmin, reason: "Only a Platform Admin can change AI credentials." },
} as const satisfies Record<string, StaffActionRule>;

export type StaffAction = keyof typeof staffActions;

const SITE_SCOPE_REASON = "Only records at your assigned sites can be changed.";

const denied = (reason: string): AccessResult => ({ allowed: false, reason: translateText(reason) });

/** Platform Admin passes every role list. */
export const hasStaffRole = (roles: readonly string[], allowed: readonly string[]): boolean =>
  roles.includes("Platform Admin") || allowed.some((role) => roles.includes(role));

export const can = (action: StaffAction, session: PermissionSession, owner?: RecordOwner): AccessResult => {
  const rule: StaffActionRule = staffActions[action];
  const roles = session.roles ?? [];
  const byRole = rule.excludesPlatformAdmin
    ? rule.roles.some((role) => roles.includes(role))
    : hasStaffRole(roles, rule.roles);
  const isOwner = owner?.ownerId !== undefined && owner.ownerId === session.userId;
  const byOwner = isOwner && (rule.ownerRoles ?? []).some((role) => roles.includes(role));
  if (!byRole && !byOwner) return denied(rule.reason);
  if (rule.separationOfDuties && isOwner) {
    return denied(rule.separationReason ?? "You cannot approve your own change");
  }
  return { allowed: true };
};

/** `can` plus the site scope of the record. Used for writes on a record that belongs to one site. */
export const canAtSite = (
  action: StaffAction,
  session: PermissionSession,
  siteId: string | undefined,
): AccessResult => {
  const role = can(action, session);
  if (!role.allowed) return role;
  const inScope =
    (session.roles ?? []).includes("Platform Admin") ||
    (siteId !== undefined && (session.siteIds ?? []).includes(siteId));
  return inScope ? { allowed: true } : denied(SITE_SCOPE_REASON);
};

/** The creator a row names, for the owner rules above. */
export const ownerOf = (value: unknown): RecordOwner => ({ ownerId: typeof value === "string" ? value : undefined });

/** A tab with no action behind it is open to every signed-in staff member. */
export const tabGate = (action: StaffAction | undefined, session: PermissionSession): AccessResult =>
  action === undefined ? { allowed: true } : can(action, session);

/** The plan fields a permission rule reads: who owns the plan and which site it belongs to. */
export type ActionPlanAccessTarget = { ownerId: string; siteId: string | null };

const ACTION_PLAN_STATUS_REASON = "Only the plan's owner can change its status.";

/**
 * Giving a plan to another owner: a Pharmacy Manager (or Platform Admin) inside the plan's site. It is all a manager
 * changes on a plan (BR-PLAN-001). A plan with no site is Platform Admin's alone, as the server's site scope says.
 */
export const canReassignActionPlan = (session: PermissionSession, plan: ActionPlanAccessTarget): AccessResult =>
  canAtSite("actionPlan.reassign", session, plan.siteId ?? undefined);

/** Status of an action plan: its owner alone moves it through open, in progress and done. */
export const canChangeActionPlanStatus = (session: PermissionSession, plan: ActionPlanAccessTarget): AccessResult =>
  session.userId !== undefined && plan.ownerId === session.userId
    ? { allowed: true }
    : denied(ACTION_PLAN_STATUS_REASON);
