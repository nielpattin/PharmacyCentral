import { translateText } from "../i18n.ts";

/**
 * What each staff action needs before the server answers it. The UI reads this map so a staff member never clicks a
 * control the server would refuse with 403.
 *
 * The role column follows the authorizer that answers in AWS, `deploy/aws/lambda/policy.mjs`
 * (`employeeRolesForRequest`, `isEmployeeRoleAllowed`), because that is the 403 a staff member actually gets. `guard`
 * names the route file or policy list that backs each rule. Where a service adds a rule of its own, `guard` says so.
 *
 * Platform Admin passes every role rule, as `canAccessSection` in App.tsx does. It does not pass a separation-of-duties
 * rule: the server refuses a Platform Admin who approves their own change as well (BR-SYN-004).
 */

export const STAFF_ROLES = ["Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** The slice of the signed-in session the rules read. `useSession()` returns it. */
export type PermissionSession = {
  roles?: readonly string[] | undefined;
  userId?: string | undefined;
};

/** The record an action works on, for rules that depend on who created it. */
export type RecordOwner = { ownerId: string | undefined };

export type AccessResult = { allowed: true } | { allowed: false; reason: string };

type StaffActionRule = {
  /** Roles the server admits. An empty list means Platform Admin only. */
  roles: readonly StaffRole[];
  /** English sentence. It is translated when the result is built, so it is also the i18n key. */
  reason: string;
  /** The server refuses the owner of the record. Set only where the server enforces it. */
  separationOfDuties?: true;
  guard: string;
};

const pharmacist = ["Pharmacist"] as const;
const manager = ["Pharmacy Manager"] as const;
const warehouse = ["Warehouse Staff"] as const;
const platformAdmin = [] as const;

export const staffActions = {
  "prescription.create": {
    roles: pharmacist,
    reason: "Only a Pharmacist can create prescriptions.",
    guard: "policy.mjs counterRoles (POST /api/prescriptions); sales-routes.ts:443",
  },
  "prescription.dispense": {
    roles: pharmacist,
    reason: "Only a Pharmacist can dispense prescriptions.",
    guard: "policy.mjs counterRoles (POST /api/prescriptions/:id/dispense); sales-routes.ts:523",
  },
  "prescription.cancel": {
    roles: pharmacist,
    reason: "Only a Pharmacist can cancel prescriptions.",
    guard: "policy.mjs counterRoles (POST /api/prescriptions/:id/cancel); sales-routes.ts:507",
  },
  "prescription.createInvoice": {
    roles: pharmacist,
    reason: "Only a Pharmacist can create a counter invoice.",
    guard: "policy.mjs counterRoles (POST /api/payments/prescriptions/:id); payment-routes.ts:29",
  },
  "consultation.answer": {
    roles: pharmacist,
    reason: "Only a Pharmacist can answer consultations.",
    guard: "policy.mjs counterRoles (POST consultations/:id/answer); prescription-consultation-routes.ts:159",
  },
  "payment.confirmCash": {
    roles: pharmacist,
    reason: "Only a Pharmacist can confirm cash payments.",
    guard: "policy.mjs counterRoles (POST /api/payments/:id/confirm-counter); payment-routes.ts:209",
  },
  "payment.refund": {
    roles: pharmacist,
    reason: "Only a Pharmacist can refund payments.",
    guard: "policy.mjs counterRoles (POST /api/payments/:id/refund); payment-routes.ts:221",
  },
  "payment.invoices.view": {
    roles: ["Pharmacist", "Pharmacy Manager"],
    reason: "Only a Pharmacist or Pharmacy Manager can view payment invoices.",
    guard: "policy.mjs counterRoles (GET /api/payments/invoices)",
  },
  "customer.lookup": {
    roles: pharmacist,
    reason: "Only a Pharmacist can look up customers.",
    guard: "policy.mjs /api/customers -> Pharmacist; identity account-routes.ts:41, :405",
  },
  "finance.summary.view": {
    roles: manager,
    reason: "Only a Pharmacy Manager can view the finance summary.",
    guard: "policy.mjs managementOnlyPaths (/api/finance)",
  },
  "purchaseOrder.create": {
    roles: manager,
    reason: "Only a Pharmacy Manager can create purchase orders.",
    guard: "policy.mjs managementPaths (POST /api/procurement/purchase-orders); procurement-routes.ts:65",
  },
  // No separation-of-duties rule: procurement-repository.ts:150-164 lets the creator approve. BR-PROC-005 covers only
  // the Draft status. Do not add a UI-only rule the server does not enforce.
  "purchaseOrder.approve": {
    roles: manager,
    reason: "Only a Pharmacy Manager can approve purchase orders.",
    guard: "policy.mjs managementPaths (POST .../purchase-orders/:id/action); procurement-routes.ts:83",
  },
  "purchaseOrder.cancel": {
    roles: manager,
    reason: "Only a Pharmacy Manager can cancel purchase orders.",
    guard: "policy.mjs managementPaths (POST .../purchase-orders/:id/action); procurement-routes.ts:83",
  },
  "goodsReceipt.view": {
    roles: warehouse,
    reason: "Only Warehouse Staff can view goods receipts.",
    guard: "policy.mjs warehousePaths (GET /api/procurement/goods-receipts, every method)",
  },
  "goodsReceipt.create": {
    roles: warehouse,
    reason: "Only Warehouse Staff can receive goods.",
    guard: "policy.mjs warehousePaths; procurement-routes.ts:135",
  },
  "inventory.records.view": {
    roles: warehouse,
    reason: "Only Warehouse Staff can view batches, movements and stock records.",
    guard: "policy.mjs warehousePaths (GET batches, movements, adjustments, transfers, stocktakes, returns)",
  },
  "inventory.batch.create": {
    roles: warehouse,
    reason: "Only Warehouse Staff can create batches.",
    guard: "policy.mjs warehousePaths; inventory-routes.ts:150",
  },
  "inventory.batch.quality": {
    roles: warehouse,
    reason: "Only Warehouse Staff can change batch quality.",
    guard: "policy.mjs warehousePaths; inventory-routes.ts:164",
  },
  "inventory.movement.create": {
    roles: warehouse,
    reason: "Only Warehouse Staff can record stock movements.",
    guard: "policy.mjs warehousePaths; inventory-routes.ts:277",
  },
  "inventory.adjustment.create": {
    roles: warehouse,
    reason: "Only Warehouse Staff can create stock adjustments.",
    guard: "policy.mjs warehousePaths; inventory-routes.ts:200",
  },
  // No separation-of-duties rule: BR-GAP-004 records that transitionAdjustment does not compare creator and approver.
  "inventory.adjustment.decide": {
    roles: warehouse,
    reason: "Only Warehouse Staff can approve or reject adjustments.",
    guard: "policy.mjs warehousePaths; inventory-routes.ts:215",
  },
  "inventory.transfer.create": {
    roles: warehouse,
    reason: "Only Warehouse Staff can create transfers.",
    guard: "policy.mjs warehousePaths; inventory-routes.ts:439",
  },
  // No separation-of-duties rule: BR-GAP-004 covers transitionTransfer too.
  "inventory.transfer.transition": {
    roles: warehouse,
    reason: "Only Warehouse Staff can approve, ship, receive or cancel transfers.",
    guard: "policy.mjs warehousePaths; inventory-routes.ts:455",
  },
  "inventory.stocktake.create": {
    roles: warehouse,
    reason: "Only Warehouse Staff can start stocktakes.",
    guard: "policy.mjs warehousePaths; inventory-routes.ts:519",
  },
  "inventory.stocktake.count": {
    roles: warehouse,
    reason: "Only Warehouse Staff can record stock counts.",
    guard: "policy.mjs warehousePaths (stocktake-lines); inventory-routes.ts:534",
  },
  "inventory.stocktake.post": {
    roles: warehouse,
    reason: "Only Warehouse Staff can post stocktakes.",
    guard: "policy.mjs warehousePaths; inventory-routes.ts:547",
  },
  "inventory.return.create": {
    roles: warehouse,
    reason: "Only Warehouse Staff can record returns.",
    guard: "policy.mjs warehousePaths; inventory-routes.ts:570",
  },
  "replenishment.view": {
    roles: ["Pharmacist", "Warehouse Staff"],
    reason: "Only a Pharmacist or Warehouse Staff can view replenishment requests.",
    guard: "policy.mjs replenishmentPaths",
  },
  "replenishment.create": {
    roles: ["Pharmacist", "Warehouse Staff"],
    reason: "Only a Pharmacist or Warehouse Staff can create replenishment requests.",
    guard: "policy.mjs replenishmentPaths; inventory-routes.ts:608",
  },
  // BR-REP-006 says only warehouse staff approve. The edge admits Pharmacist too; the UI follows the edge.
  "replenishment.decide": {
    roles: ["Pharmacist", "Warehouse Staff"],
    reason: "Only a Pharmacist or Warehouse Staff can approve, reject, fulfil or cancel replenishment requests.",
    guard: "policy.mjs replenishmentPaths; inventory-routes.ts:627",
  },
  "catalog.write": {
    roles: manager,
    reason: "Only a Pharmacy Manager can change the catalog and master data.",
    guard: "policy.mjs managementPaths (non-GET sites, storage-locations, suppliers, products, pricing/prices)",
  },
  "catalog.import": {
    roles: manager,
    reason: "Only a Pharmacy Manager can import products, sites, storage locations or suppliers.",
    guard: "policy.mjs managementPaths (POST /api/products/imports); catalog-import-routes.ts:12",
  },
  "stock.import": {
    roles: ["Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"],
    reason: "Only signed-in staff can import opening balances.",
    guard: "policy.mjs: no role for POST /api/inventory/imports/opening-balances; inventory-import-routes.ts:9",
  },
  // Edge admits Pharmacy Manager only (managementPaths /api/products). The service also admits Pharmacist
  // (search-synonym-routes.ts:23). The UI follows the edge; change this list if the edge is changed.
  "synonym.write": {
    roles: manager,
    reason: "Only a Pharmacy Manager can change search synonyms.",
    guard: "policy.mjs managementPaths (/api/products/search-synonyms); search-synonym-routes.ts:23",
  },
  "synonym.approve": {
    roles: manager,
    reason: "Only a Pharmacy Manager can approve search synonyms.",
    separationOfDuties: true,
    guard: "policy.mjs managementPaths; search-synonym-routes.ts:130; search-synonym-service.ts:119; BR-SYN-004",
  },
  "governance.user.write": {
    roles: platformAdmin,
    reason: "Only a Platform Admin can manage staff accounts.",
    guard: "policy.mjs platformAdminPaths (/api/admin); identity account-routes.ts:314",
  },
  "ai.credential.write": {
    roles: platformAdmin,
    reason: "Only a Platform Admin can change AI credentials.",
    guard: "policy.mjs platformAdminPaths (aiCredentialPaths); catalog credential-routes.ts:53",
  },
} as const satisfies Record<string, StaffActionRule>;

export type StaffAction = keyof typeof staffActions;

const denied = (reason: string): AccessResult => ({ allowed: false, reason: translateText(reason) });

/** Platform Admin passes every role list. Same rule as `canAccessSection` in App.tsx. */
export const hasStaffRole = (roles: readonly string[], allowed: readonly string[]): boolean =>
  roles.includes("Platform Admin") || allowed.some((role) => roles.includes(role));

export const can = (action: StaffAction, session: PermissionSession, owner?: RecordOwner): AccessResult => {
  const rule: StaffActionRule = staffActions[action];
  const roles = session.roles ?? [];
  if (!hasStaffRole(roles, rule.roles)) return denied(rule.reason);
  if (rule.separationOfDuties && owner?.ownerId !== undefined && owner.ownerId === session.userId) {
    return denied("You cannot approve your own change");
  }
  return { allowed: true };
};

/** A tab or create button with no action behind it is open to every signed-in staff member. */
export const tabGate = (action: StaffAction | undefined, session: PermissionSession): AccessResult =>
  action === undefined ? { allowed: true } : can(action, session);
