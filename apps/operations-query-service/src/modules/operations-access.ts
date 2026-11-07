import type { Request } from "express";

/**
 * Role gates for the staff reads. The trusted-request middleware admits these roles; this module refuses everyone
 * else before the handler reads anything. Platform Admin passes every
 * check, so it is listed explicitly wherever a screen admits it.
 */

/** The dashboard screen: attention tiles and recent activity. Pharmacist has no dashboard (staff-shell decision 14). */
export const DASHBOARD_ROLES: readonly string[] = ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"];

/**
 * Period analytics (design 0007): business figures (revenue, orders, customers, gross profit, targets) for the Pharmacy
 * Manager alone. Platform Admin administers the system and has no business to read here; Warehouse Staff and Pharmacist
 * have no analytics screen.
 */
export const ANALYTICS_ROLES: readonly string[] = ["Pharmacy Manager"];

/**
 * The audit action families the dashboard's recent activity may list for a set of roles, or undefined for every
 * family. An action is named `<family>.<entity>.<verb>` (`inventory.transfer.approved`, `procurement.purchase-order.created`),
 * so a family is the part before the first dot. Platform Admin and Pharmacy Manager read every family; Warehouse Staff
 * read only the stock and purchasing ones. An account that holds several roles gets what its widest role may read, and
 * a role set with no dashboard role gets nothing. The Audit page stays Platform Admin only; this is the dashboard card.
 */
export const dashboardActionFamilies = (roles: readonly string[]): readonly string[] | undefined => {
  if (roles.includes("Platform Admin") || roles.includes("Pharmacy Manager")) return undefined;
  if (roles.includes("Warehouse Staff")) return WAREHOUSE_ACTION_FAMILIES;
  return [];
};

const WAREHOUSE_ACTION_FAMILIES: readonly string[] = ["inventory", "procurement"];

export type RoleRefusal = {
  status: 403;
  title: string;
  code: "role_forbidden";
  detail: string;
};

export const actorRoles = (request: Request): string[] =>
  (request.header("x-actor-roles") ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0);

/** Refuses unless a verified employee holds one of `allowed`; a service or shopper caller is refused too. */
export const roleRefusal = (request: Request, allowed: readonly string[], detail: string): RoleRefusal | undefined => {
  if (request.header("x-actor-type") === "employee" && actorRoles(request).some((role) => allowed.includes(role))) {
    return undefined;
  }
  return { status: 403, title: "Role not allowed", code: "role_forbidden", detail };
};
