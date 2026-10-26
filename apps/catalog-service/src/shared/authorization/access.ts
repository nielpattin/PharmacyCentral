import type { RequestHandler, Response } from "express";

import { verifyInternalIdentityContext } from "../../middleware/trusted-request.ts";
import type { Refusal } from "../refusal.ts";
import { PLATFORM_ADMIN, holdsRole, type RoleRule } from "./policy.ts";

export type IdentityOptions = { identitySecret: string; audience: string };

/** The employee a route verified from the signed context: who they are, what they may do, and where. */
export type StaffActor = { actorId: string; roles: readonly string[]; siteIds: readonly string[] };

const STAFF_ACTOR = "staffActor";

export const refuse = (response: Response, refusal: Refusal): void => {
  response.status(refusal.status).json({
    title: refusal.title,
    status: refusal.status,
    code: refusal.code,
    detail: refusal.detail,
  });
};

export const SIGN_IN_REQUIRED: Refusal = {
  status: 401,
  code: "unauthenticated",
  title: "Sign in required",
  detail: "Vui lòng đăng nhập để tiếp tục.",
};

export const EMPLOYEE_REQUIRED: Refusal = {
  status: 403,
  code: "employee_required",
  title: "Employee access required",
  detail: "Chỉ nhân viên mới được thực hiện thao tác này.",
};

export const ROLE_FORBIDDEN: Refusal = {
  status: 403,
  code: "role_forbidden",
  title: "Role not allowed",
  detail: "Bạn không có quyền thực hiện thao tác này.",
};

export const SITE_ACCESS_DENIED: Refusal = {
  status: 403,
  code: "site_access_denied",
  title: "Site access denied",
  detail: "Cơ sở này không nằm trong phạm vi được phân công của bạn.",
};

/**
 * Verifies the signed identity context on this request and requires an employee. With `rule`, the employee must also
 * hold one of its roles. The verified actor is kept for the handler, so a route never trusts a client-sent header.
 */
export const requireEmployee =
  (identity: IdentityOptions, rule?: RoleRule): RequestHandler =>
  (request, response, next) => {
    const context = verifyInternalIdentityContext(
      request.header("x-internal-identity-context"),
      identity.identitySecret,
      new Date(),
      identity.audience,
    );
    if (!context) return refuse(response, SIGN_IN_REQUIRED);
    if (context.actorType !== "employee" || !context.actorId) return refuse(response, EMPLOYEE_REQUIRED);
    if (rule && !holdsRole(context.roles, rule)) return refuse(response, ROLE_FORBIDDEN);
    const actor: StaffActor = { actorId: context.actorId, roles: context.roles, siteIds: context.siteIds };
    response.locals[STAFF_ACTOR] = actor;
    next();
  };

export const staffActorOf = (response: Response): StaffActor => {
  const actor = response.locals[STAFF_ACTOR] as StaffActor | undefined;
  if (!actor) throw new Error("requireEmployee must run before a handler reads the staff actor");
  return actor;
};

/**
 * The sites a site-scoped employee may read or write: their assigned sites, which may be none. Platform Admin has no
 * site limit, so the scope is undefined and nothing is narrowed.
 */
export const siteScopeOf = (actor: StaffActor): string[] | undefined =>
  actor.roles.includes(PLATFORM_ADMIN) ? undefined : [...actor.siteIds];

/** True when a record at `siteId` lies outside the actor's sites. Checked before any write on that record. */
export const isOutsideSiteScope = (actor: StaffActor, siteId: string): boolean => {
  const scope = siteScopeOf(actor);
  return scope !== undefined && !scope.includes(siteId);
};
