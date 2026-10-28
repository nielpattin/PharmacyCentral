import type { Request } from "express";

/**
 * Role gates for the staff reads, restated for the local stack (see `deploy/aws/lambda/policy.mjs`). The edge admits
 * these roles; this module refuses everyone else before the handler reads anything. Platform Admin passes every
 * check, so it is listed explicitly wherever a screen admits it.
 */

/** The dashboard screen: attention tiles and recent activity. Pharmacist has no dashboard (staff-shell decision 14). */
export const DASHBOARD_ROLES: readonly string[] = ["Platform Admin", "Pharmacy Manager", "Warehouse Staff"];

/** Reporting: Platform Admin and Pharmacy Manager only. Warehouse Staff have no reporting screen. */
export const REPORT_ROLES: readonly string[] = ["Platform Admin", "Pharmacy Manager"];

/** Period analytics (design 0007): the reporting roles. Warehouse Staff and Pharmacist have no analytics screen. */
export const ANALYTICS_ROLES: readonly string[] = ["Platform Admin", "Pharmacy Manager"];

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
