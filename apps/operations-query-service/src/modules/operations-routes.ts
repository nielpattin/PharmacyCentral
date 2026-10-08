import { Router } from "express";
import { z } from "zod";

import { listSiteIds } from "../middleware/trusted-request.ts";
import { OperationsRepository, type IntegrationEvent } from "./operations-repository.ts";

const eventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  actorId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()),
});

export const createOperationsRouter = (repository: OperationsRepository | undefined): Router => {
  const router = Router();
  const dashboard = async (
    request: import("express").Request,
    response: import("express").Response,
    next: import("express").NextFunction,
  ): Promise<void> => {
    if (!repository) {
      unavailable(response);
      return;
    }
    try {
      response.json(await repository.dashboard(listSiteIds(request)));
    } catch (error) {
      next(error);
    }
  };
  const audit = async (
    request: import("express").Request,
    response: import("express").Response,
    next: import("express").NextFunction,
  ): Promise<void> => {
    if (!repository) {
      unavailable(response);
      return;
    }
    try {
      const filters: {
        limit?: number;
        actorId?: string;
        siteIds?: string[];
        action?: string;
        entityType?: string;
        entityId?: string;
        from?: string;
        to?: string;
      } = {};
      const limit = queryNumber(request.query.limit);
      const actorId = queryString(request.query.actorId) ?? queryString(request.query.userId);
      const siteIds = listSiteIds(request);
      const entityId = queryString(request.query.entityId);
      const action = queryString(request.query.action);
      const entityType = queryString(request.query.entityType);
      const from = queryString(request.query.from);
      const to = queryString(request.query.to);
      if (limit !== undefined) filters.limit = limit;
      if (actorId) filters.actorId = actorId;
      if (siteIds) filters.siteIds = siteIds;
      if (action) filters.action = action;
      if (entityType) filters.entityType = entityType;
      if (entityId) filters.entityId = entityId;
      if (from) filters.from = from;
      if (to) filters.to = to;
      response.json(await repository.listAudit(filters));
    } catch (error) {
      next(error);
    }
  };
  const finance = async (
    request: import("express").Request,
    response: import("express").Response,
    next: import("express").NextFunction,
  ): Promise<void> => {
    if (!repository) {
      unavailable(response);
      return;
    }
    try {
      response.json(
        await repository.financeSummary(
          queryString(request.query.from),
          queryString(request.query.to),
          listSiteIds(request),
        ),
      );
    } catch (error) {
      next(error);
    }
  };

  router.get("/operations/dashboard", dashboard);
  router.get("/dashboard/summary", dashboard);
  router.get("/operations/audit", audit);
  router.get("/audit/logs", audit);
  router.get("/finance/summary", finance);
  router.get("/operations/finance", finance);
  router.get("/reports", async (request, response, next) => {
    if (!repository) {
      unavailable(response);
      return;
    }
    try {
      response.json(
        await repository.report(queryString(request.query.reportType), queryNumber(request.query.limit) ?? 100),
      );
    } catch (error) {
      next(error);
    }
  });
  router.post("/internal/events", async (request, response, next) => {
    if (!repository) {
      unavailable(response);
      return;
    }
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) {
      invalid(response);
      return;
    }
    try {
      response.status(202).json({ accepted: await repository.apply(parsed.data as IntegrationEvent) });
    } catch (error) {
      next(error);
    }
  });
  return router;
};

const queryString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const queryNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const unavailable = (response: import("express").Response) =>
  response.status(503).json({ title: "Operations database is not configured", status: 503 });
const invalid = (response: import("express").Response) =>
  response.status(400).json({ title: "Invalid event", status: 400, code: "invalid_request" });
