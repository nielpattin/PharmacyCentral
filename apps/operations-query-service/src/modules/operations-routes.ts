import { Router, type Response } from "express";
import { z } from "zod";

import { listSiteIds } from "../middleware/trusted-request.ts";
import { signCatalogIdentity } from "./catalog-identity.ts";
import { analyticsQuerySchema } from "./analytics.ts";
import { ANALYTICS_ROLES, DASHBOARD_ROLES, REPORT_ROLES, roleRefusal } from "./operations-access.ts";
import { decodePageCursor, encodePageCursor } from "./page-cursor.ts";
import {
  AnalyticsReadError,
  OperationsRepository,
  type AuditFilters,
  type IntegrationEvent,
} from "./operations-repository.ts";

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
    const refusal = roleRefusal(
      request,
      DASHBOARD_ROLES,
      "Bảng điều khiển chỉ dành cho Quản trị nền tảng, Quản lý dược và Nhân viên kho.",
    );
    if (refusal) {
      response.status(refusal.status).json(refusal);
      return;
    }
    try {
      response.json(await repository.dashboard(() => signCatalogIdentity(request), listSiteIds(request)));
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
      const filters: AuditFilters = {};
      const limit = queryNumber(request.query.limit);
      const actorId = queryString(request.query.actorId) ?? queryString(request.query.userId);
      const siteIds = listSiteIds(request);
      const entityId = queryString(request.query.entityId);
      const action = queryString(request.query.action);
      const entityType = queryString(request.query.entityType);
      const from = queryString(request.query.from);
      const to = queryString(request.query.to);
      const q = queryString(request.query.q);
      const rawCursor = queryString(request.query.cursor);
      const cursor = rawCursor === undefined ? undefined : decodePageCursor(rawCursor);
      if (rawCursor !== undefined && cursor === undefined) {
        invalidCursor(response);
        return;
      }
      if (limit !== undefined) filters.limit = limit;
      if (cursor) filters.cursor = cursor;
      if (q) filters.q = q;
      if (actorId) filters.actorId = actorId;
      if (siteIds) filters.siteIds = siteIds;
      if (action) filters.action = action;
      if (entityType) filters.entityType = entityType;
      if (entityId) filters.entityId = entityId;
      if (from) filters.from = from;
      if (to) filters.to = to;
      const page = await repository.listAudit(filters);
      // The body stays a plain array; the cursor of the next page travels in a header.
      if (page.next) response.set("X-Next-Cursor", encodePageCursor(page.next));
      response.json(page.rows);
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
          () => signCatalogIdentity(request),
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
  router.get("/dashboard/analytics", async (request, response, next) => {
    if (!repository) {
      unavailable(response);
      return;
    }
    const refusal = roleRefusal(
      request,
      ANALYTICS_ROLES,
      "Phân tích kỳ chỉ dành cho Quản trị nền tảng và Quản lý dược.",
    );
    if (refusal) {
      response.status(refusal.status).json(refusal);
      return;
    }
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        detail:
          "Khoảng thời gian cần from trước to và không quá 366 ngày; siteId là UUID; channel là all, counter hoặc online.",
      });
      return;
    }
    try {
      response.json(
        await repository.dashboardAnalytics(
          {
            from: new Date(parsed.data.from),
            to: new Date(parsed.data.to),
            siteId: parsed.data.siteId,
            channel: parsed.data.channel ?? "all",
          },
          () => signCatalogIdentity(request),
          listSiteIds(request),
        ),
      );
    } catch (error) {
      // payment-service refuses a period whose paid invoices exceed its read cap; the page says so instead of a 500.
      if (error instanceof AnalyticsReadError && error.status === 422 && error.code === "analytics_range_too_large") {
        response.status(422).json({
          title: "Analytics range too large",
          status: 422,
          code: "analytics_range_too_large",
          detail: "Khoảng thời gian có quá nhiều hóa đơn đã thanh toán để tổng hợp; hãy chọn khoảng ngắn hơn.",
        });
        return;
      }
      next(error);
    }
  });
  router.get("/operations/audit", audit);
  router.get("/audit/logs", audit);
  router.get("/finance/summary", finance);
  router.get("/operations/finance", finance);
  router.get("/reports", async (request, response, next) => {
    if (!repository) {
      unavailable(response);
      return;
    }
    const refusal = roleRefusal(request, REPORT_ROLES, "Báo cáo chỉ dành cho Quản trị nền tảng và Quản lý dược.");
    if (refusal) {
      response.status(refusal.status).json(refusal);
      return;
    }
    const rawCursor = queryString(request.query.cursor);
    const cursor = rawCursor === undefined ? undefined : decodePageCursor(rawCursor);
    if (rawCursor !== undefined && cursor === undefined) {
      invalidCursor(response);
      return;
    }
    try {
      const page = await repository.report(queryString(request.query.reportType), {
        limit: queryNumber(request.query.limit) ?? 100,
        ...(cursor ? { cursor } : {}),
      });
      // The body stays a plain array; the cursor of the next page travels in a header.
      if (page.next) response.set("X-Next-Cursor", encodePageCursor(page.next));
      response.json(page.rows);
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
const invalidCursor = (response: Response) =>
  response.status(400).json({ title: "Invalid page cursor", status: 400, code: "invalid_cursor" });
