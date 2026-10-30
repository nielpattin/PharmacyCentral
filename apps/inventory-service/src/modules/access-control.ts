import type { Request, Response } from "express";

import { actorRoles, actorSiteIds } from "../middleware/trusted-request.ts";

const PLATFORM_ADMIN = "Platform Admin";

const ROLE_DENIED_DETAIL = "Vai trò của bạn không được thực hiện thao tác này.";
const SITE_DENIED_DETAIL = "Bạn không được thao tác trên địa điểm này.";
const SELF_APPROVAL_DETAIL = "Người tạo hoặc người đếm bản ghi không được tự duyệt bản ghi đó.";

/** The verified actor of the request, or undefined for a call that names none. */
export const actorIdOf = (request: Request): string | undefined => request.header("X-Actor-Id");

/** Sends the role refusal and returns false, for a route that refuses the caller after its own checks. */
export const refuseRole = (response: Response): false => {
  response.status(403).json({
    title: "Role not allowed",
    status: 403,
    code: "role_forbidden",
    detail: ROLE_DENIED_DETAIL,
  });
  return false;
};

/**
 * Sends 403 unless the actor holds one of `roles` and returns false. Platform Admin passes the checks of a read and
 * of nothing else; a system actor (another service acting for itself) passes too. Routes call this before they read
 * the record they act on.
 */
export const allowRoles = (request: Request, response: Response, roles: readonly string[]): boolean => {
  if (request.header("x-actor-type") === "system") return true;
  const held = actorRoles(request);
  const isRead = request.method === "GET" || request.method === "HEAD";
  if ((isRead && held.includes(PLATFORM_ADMIN)) || roles.some((role) => held.includes(role))) return true;
  return refuseRole(response);
};

/**
 * True for a caller who reads only the records they made: a verified employee holding none of the roles that read
 * every request (Platform Admin, Pharmacy Manager, Warehouse Staff). A pharmacist sees only their own replenishments.
 */
export const ownRequestsOnly = (request: Request): boolean => {
  if (request.header("x-actor-type") === "system") return false;
  const held = actorRoles(request);
  return ![PLATFORM_ADMIN, "Pharmacy Manager", "Warehouse Staff"].some((role) => held.includes(role));
};

const sendSiteDenied = (response: Response): void => {
  response.status(403).json({
    title: "Site access denied",
    status: 403,
    code: "site_access_denied",
    detail: SITE_DENIED_DETAIL,
  });
};

/**
 * Sends 403 and returns true when the record's sites are not all inside the actor's sites. A record with no site is
 * refused for a site-scoped actor. Platform Admin and calls without a site scope pass.
 */
export const refuseOutOfSiteScope = (request: Request, response: Response, siteIds: readonly string[]): boolean => {
  const scope = actorSiteIds(request);
  if (scope === undefined) return false;
  if (siteIds.length > 0 && siteIds.every((siteId) => scope.includes(siteId))) return false;
  sendSiteDenied(response);
  return true;
};

/**
 * Sends 403 and returns true when none of the record's sites is inside the actor's sites. Used for a transfer, which
 * belongs to the scope of either end.
 */
export const refuseUnlessAnySiteInScope = (
  request: Request,
  response: Response,
  siteIds: readonly string[],
): boolean => {
  const scope = actorSiteIds(request);
  if (scope === undefined) return false;
  if (siteIds.some((siteId) => scope.includes(siteId))) return false;
  sendSiteDenied(response);
  return true;
};

/**
 * Sends 403 and returns true when the actor recorded the item being approved, counted or requested. Separation of
 * duties applies to every role, Platform Admin included. A record without a recorder (created before the column
 * existed) is never refused.
 */
export const refuseSelfApproval = (
  request: Request,
  response: Response,
  recordedBy: string | null | undefined,
): boolean => {
  const actor = actorIdOf(request);
  if (!actor || !recordedBy || actor !== recordedBy) return false;
  response.status(403).json({
    title: "Approver must not be the creator",
    status: 403,
    code: "self_approval_forbidden",
    detail: SELF_APPROVAL_DETAIL,
  });
  return true;
};
