import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  actionPlanListQuerySchema,
  createActionPlanRequestSchema,
  updateActionPlanRequestSchema,
} from "../../contracts/action-plans.ts";
import { actorRoles, listSiteIds } from "../../middleware/trusted-request.ts";
import { actorIdOf, allowRoles, refuseOutOfSiteScope, refuseRole } from "../access-control.ts";
import { invalidCursor, sendPage } from "../keyset-page.ts";
import { readPageRequest, readSearchText, type PageOptions } from "../page-cursor.ts";
import { today } from "../site-availability.ts";

import { ActionPlanConflictError, type ActionPlanRepository } from "./action-plan-repository.ts";
import {
  changedPlanFields,
  isAllowedDueDate,
  ownerCoversSite,
  planChanges,
  planPatchAccess,
  planReadScope,
  type PlanActor,
  type PlanReadScope,
} from "./action-plan.ts";
import { EmployeeDirectoryUnavailableError, type EmployeeDirectory } from "./identity-employee-client.ts";

const idSchema = z.object({ id: z.string().uuid() });

/** Lists answer 100 rows by default, newest first, and at most 500 per page. */
const listPage: PageOptions = { kind: "timestamp", defaultLimit: 100, maxLimit: 500 };

const DUE_DATE_DETAIL = "Hạn xử lý phải là một ngày có thật, từ hôm nay trở đi.";
const INVALID_DETAIL = "Yêu cầu kế hoạch hành động không hợp lệ.";
const PLAN_NOT_FOUND = { title: "Action plan not found", status: 404, detail: "Không tìm thấy kế hoạch hành động." };
const OWNER_NOT_FOUND = {
  title: "Owner not found",
  status: 422,
  code: "owner_not_found",
  detail: "Người phụ trách phải là nhân viên đang hoạt động.",
};
const OWNER_NOT_AT_SITE = {
  title: "Owner not at site",
  status: 422,
  code: "owner_not_at_site",
  detail: "Người phụ trách phải được gán cho địa điểm của kế hoạch.",
};
const IDENTITY_UNAVAILABLE = {
  title: "Identity service unavailable",
  status: 503,
  code: "identity_unavailable",
  detail: "Không kiểm tra được người phụ trách lúc này. Vui lòng thử lại.",
};
const DATABASE_UNAVAILABLE = { title: "Action plan database is not configured", status: 503 };

type Problem = { title: string; status: number; code?: string; detail?: string; planId?: string };

/** Sends an error body in the problem shape the other services use. */
const sendProblem = (response: Response, problem: Problem) => response.status(problem.status).json(problem);

const sendInvalid = (response: Response, detail = INVALID_DETAIL) =>
  sendProblem(response, { title: "Invalid action plan request", status: 400, code: "invalid_request", detail });

/**
 * The sites a list may name. A manager reads her sites (none when unassigned); a service reads
 * everything. A site named in the query narrows that scope, and one outside it lists nothing. An owner reads only the
 * site they asked for, so a plan with no site stays visible to the owner while the site list does not hide it.
 */
const listSiteScope = (scope: PlanReadScope, request: Request, requestedSiteId: string | undefined) => {
  if (scope.kind === "owner") return requestedSiteId === undefined ? undefined : [requestedSiteId];
  const assigned = listSiteIds(request);
  if (requestedSiteId !== undefined) {
    // A requested site narrows the caller's own sites; one outside them lists nothing.
    return assigned === undefined || assigned.includes(requestedSiteId) ? [requestedSiteId] : [];
  }
  return scope.kind === "sites" ? (assigned ?? []) : assigned;
};

export type ActionPlanRouterOptions = {
  /** Validates the owner of a plan against identity-service. Injected so tests and boot wire their own. */
  employees: EmployeeDirectory;
};

export const createActionPlanRouter = (
  repository: ActionPlanRepository | undefined,
  options: ActionPlanRouterOptions,
): Router => {
  const router = Router();

  // Managers see the plans of their sites; everyone else sees only the plans they own.
  router.get("/inventory/action-plans", async (request, response, next) => {
    if (!repository) return sendProblem(response, DATABASE_UNAVAILABLE);
    const actor: PlanActor = {
      id: actorIdOf(request),
      roles: actorRoles(request),
      system: request.header("x-actor-type") === "system",
    };
    const scope = planReadScope(actor);
    if (!scope) {
      refuseRole(response);
      return;
    }
    const page = readPageRequest(request.query, listPage);
    if (!page) return invalidCursor(response);
    const query = actionPlanListQuerySchema.safeParse(request.query);
    if (!query.success) return sendInvalid(response);
    // An owner asking for another person's plans reads an empty page, as those plans are not theirs to see.
    if (scope.kind === "owner" && query.data.ownerId !== undefined && query.data.ownerId !== scope.ownerId) {
      return sendPage(response, { rows: [], nextCursor: undefined });
    }
    try {
      return sendPage(
        response,
        await repository.listActionPlans(
          {
            siteIds: listSiteScope(scope, request, query.data.siteId),
            ownerId: scope.kind === "owner" ? scope.ownerId : query.data.ownerId,
            status: query.data.status,
            sourceType: query.data.sourceType,
            q: readSearchText(request.query),
          },
          page,
        ),
      );
    } catch (error) {
      return next(error);
    }
  });

  router.post("/inventory/action-plans", async (request, response, next) => {
    if (!repository) return sendProblem(response, DATABASE_UNAVAILABLE);
    if (!allowRoles(request, response, ["Pharmacy Manager"])) return;
    const parsed = createActionPlanRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendInvalid(response);
    const body = parsed.data;
    if (!isAllowedDueDate(body.dueDate, today())) return sendInvalid(response, DUE_DATE_DETAIL);
    if (refuseOutOfSiteScope(request, response, body.siteId ? [body.siteId] : [])) return;
    const createdBy = actorIdOf(request);
    if (!createdBy) {
      refuseRole(response);
      return;
    }
    try {
      const owner = await options.employees.findActiveEmployee(body.ownerId);
      if (!owner) return sendProblem(response, OWNER_NOT_FOUND);
      if (!ownerCoversSite(owner, body.siteId ?? null)) return sendProblem(response, OWNER_NOT_AT_SITE);
      const plan = await repository.createActionPlan({
        sourceType: body.sourceType,
        sourceRef: body.sourceRef,
        title: body.title,
        detail: body.detail || null,
        siteId: body.siteId ?? null,
        productId: body.productId ?? null,
        ownerId: body.ownerId,
        dueDate: body.dueDate,
        status: "open",
        createdBy,
      });
      return response.status(201).json(plan);
    } catch (error) {
      if (error instanceof ActionPlanConflictError) {
        return sendProblem(response, {
          title: "Plan exists",
          status: 409,
          code: "plan_exists",
          detail: "Đã có kế hoạch đang mở cho cùng nguồn này.",
          planId: error.planId,
        });
      }
      if (error instanceof EmployeeDirectoryUnavailableError) return sendProblem(response, IDENTITY_UNAVAILABLE);
      return next(error);
    }
  });

  // The owner moves the status of her own plan; a manager changes its owner, due date and title, inside her sites, and nothing else.
  router.patch("/inventory/action-plans/:id", async (request, response, next) => {
    if (!repository) return sendProblem(response, DATABASE_UNAVAILABLE);
    const id = idSchema.safeParse(request.params);
    const parsed = updateActionPlanRequestSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return sendInvalid(response);
    const patch = parsed.data;
    if (patch.dueDate !== undefined && !isAllowedDueDate(patch.dueDate, today())) {
      return sendInvalid(response, DUE_DATE_DETAIL);
    }
    const now = new Date();
    try {
      const current = await repository.findActionPlan(id.data.id);
      if (!current) return sendProblem(response, PLAN_NOT_FOUND);
      const actor: PlanActor = {
        id: actorIdOf(request),
        roles: actorRoles(request),
        system: request.header("x-actor-type") === "system",
      };
      const access = planPatchAccess(actor, current, changedPlanFields(patch));
      if (access === "refuse") {
        refuseRole(response);
        return;
      }
      if (access === "reassign" && refuseOutOfSiteScope(request, response, current.siteId ? [current.siteId] : []))
        return;
      if (patch.ownerId !== undefined && patch.ownerId !== current.ownerId) {
        const owner = await options.employees.findActiveEmployee(patch.ownerId);
        if (!owner) return sendProblem(response, OWNER_NOT_FOUND);
        if (!ownerCoversSite(owner, current.siteId)) return sendProblem(response, OWNER_NOT_AT_SITE);
      }
      const plan = await repository.updateActionPlan(current.id, planChanges(current, patch, now), now);
      if (!plan) return sendProblem(response, PLAN_NOT_FOUND);
      return response.json(plan);
    } catch (error) {
      if (error instanceof ActionPlanConflictError) {
        return sendProblem(response, {
          title: "Plan exists",
          status: 409,
          code: "plan_exists",
          detail: "Đã có kế hoạch đang mở cho cùng nguồn này.",
          planId: error.planId,
        });
      }
      if (error instanceof EmployeeDirectoryUnavailableError) return sendProblem(response, IDENTITY_UNAVAILABLE);
      return next(error);
    }
  });

  return router;
};
