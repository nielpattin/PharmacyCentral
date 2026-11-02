import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { listSiteIds } from "../middleware/trusted-request.ts";
import { callerAuthorization } from "./catalog-identity.ts";
import { analyticsQuerySchema, salesTargetQuerySchema } from "./analytics.ts";
import { AnalyticsCache } from "./analytics-cache.ts";
import { ANALYTICS_ROLES, DASHBOARD_ROLES, REPORT_ROLES, roleRefusal } from "./operations-access.ts";
import { decodePageCursor, encodePageCursor } from "./page-cursor.ts";
import {
  AnalyticsReadError,
  OperationsRepository,
  type AuditFilters,
  type IntegrationEvent,
} from "./operations-repository.ts";

const ANALYTICS_CACHE_TTL_MS = 30_000;
const ANALYTICS_CACHE_MAX_ENTRIES = 200;

/**
 * The key of one cached analytics answer: the tab asked for, the period, the filter and the caller's site scope. `*` is a
 * caller with no site restriction, the empty string a site-scoped caller assigned no site; the scope is sorted, so two
 * callers whose access differs never share a row. Nothing about the caller's identity enters the key.
 */
const analyticsCacheKey = (parts: {
  section: string;
  from: string;
  to: string;
  siteId: string | undefined;
  channel: string | undefined;
  scope: readonly string[] | undefined;
}): string =>
  [
    "dashboard/analytics",
    parts.section,
    parts.from,
    parts.to,
    parts.siteId ?? "",
    parts.channel ?? "all",
    parts.scope === undefined ? "*" : [...parts.scope].sort().join(","),
  ].join("|");

const eventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  actorId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()),
});

export const createOperationsRouter = (repository: OperationsRepository | undefined): Router => {
  const router = Router();
  // One cache per router: a restart or a second task starts cold, and a stale row lives at most the TTL.
  const analyticsCache = new AnalyticsCache({
    ttlMs: ANALYTICS_CACHE_TTL_MS,
    maxEntries: ANALYTICS_CACHE_MAX_ENTRIES,
  });
  /** payment-service refuses a period whose paid invoices exceed its read cap; the page says so instead of a 500. */
  const refuseRange = (response: Response, error: unknown, next: NextFunction): void => {
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
  };
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
      response.json(await repository.dashboard(() => callerAuthorization(request), listSiteIds(request)));
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
          () => callerAuthorization(request),
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
          "Cần section là overview, revenue, customers hoặc inventory; khoảng thời gian cần from trước to và không quá 366 ngày; siteId là UUID; channel là all, counter hoặc online.",
      });
      return;
    }
    const operations = repository;
    const { section, from, to, siteId } = parsed.data;
    const channel = parsed.data.channel ?? "all";
    const siteIds = listSiteIds(request);
    try {
      const cached = await analyticsCache.getOrLoad(
        analyticsCacheKey({
          section,
          from,
          to,
          siteId,
          channel,
          scope: siteIds,
        }),
        () =>
          operations.dashboardAnalytics(
            { section, from: new Date(from), to: new Date(to), siteId, channel },
            () => callerAuthorization(request),
            siteIds,
          ),
      );
      response.set("X-Analytics-Cache", cached.outcome);
      response.json(cached.value);
    } catch (error) {
      refuseRange(response, error, next);
    }
  });
  router.get("/dashboard/sales-targets", async (request, response, next) => {
    if (!repository) {
      unavailable(response);
      return;
    }
    const refusal = roleRefusal(
      request,
      ANALYTICS_ROLES,
      "Mục tiêu doanh số chỉ dành cho Quản trị nền tảng và Quản lý dược.",
    );
    if (refusal) {
      response.status(refusal.status).json(refusal);
      return;
    }
    const parsed = salesTargetQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        detail: "Cần month dạng YYYY-MM; from trước to và không quá 366 ngày; siteId là UUID.",
      });
      return;
    }
    const operations = repository;
    const { month, from, to, siteId } = parsed.data;
    const siteIds = listSiteIds(request);
    try {
      // Targets are never cached: a target changed by `PUT /api/sales-targets` must show on the very next read.
      response.json(
        await operations.salesTargetsReport(
          { month, from: new Date(from), to: new Date(to), siteId },
          () => callerAuthorization(request),
          siteIds,
        ),
      );
    } catch (error) {
      refuseRange(response, error, next);
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
