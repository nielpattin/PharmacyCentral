import { Router } from "express";
import { z } from "zod";

import {
  createGoodsReceiptRequestSchema,
  createPurchaseOrderRequestSchema,
  createReplenishmentDraftOrdersRequestSchema,
  purchaseOrderActionSchema,
} from "../contracts/procurement.ts";
import { internalServiceHeaders } from "../internal-service-headers.ts";
import { listSiteIds } from "../middleware/trusted-request.ts";

import { allowRoles, refuseOutOfSiteScope, refuseSelfApproval } from "./access-control.ts";
import { signCatalogIdentity } from "./catalog-identity.ts";
import { ProcurementRepository } from "./procurement-repository.ts";
import { DEFAULT_REPLENISHMENT_PARAMS, replenishmentSuggestions } from "./replenishment-suggestions.ts";
import { invalidCursor, sendPage } from "./keyset-page.ts";
import { readPageRequest, readSearchText, type PageOptions } from "./page-cursor.ts";

const idSchema = z.object({ id: z.string().uuid() });
const actor = (request: import("express").Request): string =>
  request.header("X-Actor-Id") ?? "00000000-0000-4000-8000-000000000001";

/** Lists answer 100 rows by default, newest first, and at most 500 per page. */
const listPage: PageOptions = { kind: "timestamp", defaultLimit: 100, maxLimit: 500 };

const DAY_MS = 24 * 60 * 60 * 1000;
/** The note of a draft created from a suggestion, unless the manager writes another one. */
const REPLENISHMENT_DRAFT_NOTE = "Tạo từ gợi ý bổ sung hàng; cần kiểm tra và duyệt trước khi đặt.";

/** An integer query parameter with its default and its range (design 0007): the answer is 400 outside the range. */
const integerQuery = (fallback: number, min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .optional()
    .transform((value) => value ?? fallback);

const replenishmentQuerySchema = z.object({
  siteId: z.string().uuid(),
  windowDays: integerQuery(DEFAULT_REPLENISHMENT_PARAMS.windowDays, 7, 180),
  coverDays: integerQuery(DEFAULT_REPLENISHMENT_PARAMS.coverDays, 1, 90),
  safetyDays: integerQuery(DEFAULT_REPLENISHMENT_PARAMS.safetyDays, 0, 60),
  defaultLeadTimeDays: integerQuery(DEFAULT_REPLENISHMENT_PARAMS.defaultLeadTimeDays, 1, 90),
});

export type ProcurementRouterOptions = {
  /** Validated at boot by main.ts, so a missing one is a type error and never a localhost guess. */
  catalogServiceUrl: string;
};

export const createProcurementRouter = (
  repository: ProcurementRepository | undefined,
  options: ProcurementRouterOptions,
): Router => {
  const router = Router();
  router.get("/procurement/purchase-orders", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    const page = readPageRequest(request.query, listPage);
    if (!page) return invalidCursor(response);
    try {
      return sendPage(
        response,
        await repository.listPurchaseOrders(
          {
            siteIds: listSiteIds(request),
            status: typeof request.query.status === "string" ? request.query.status : undefined,
            q: readSearchText(request.query),
          },
          page,
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/procurement/purchase-orders/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const order = await repository.getPurchaseOrder(id.data.id);
      if (!order) return response.status(404).json({ title: "Purchase order not found", status: 404 });
      if (refuseOutOfSiteScope(request, response, [order.siteId])) return;
      return response.json(order);
    } catch (error) {
      return next(error);
    }
  });
  router.post("/procurement/purchase-orders", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager"])) return;
    const parsed = createPurchaseOrderRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    if (refuseOutOfSiteScope(request, response, [parsed.data.siteId])) return;
    try {
      await assertCatalogReferences(
        options.catalogServiceUrl,
        signCatalogIdentity(request),
        [parsed.data.supplierId],
        parsed.data.siteId,
        parsed.data.lines.map((line) => line.productId),
      );
      return response
        .status(201)
        .json(await repository.createPurchaseOrder({ ...parsed.data, createdBy: actor(request) }));
    } catch (error) {
      return next(error);
    }
  });
  // Suggestions are computed from the stock, the ledger and the open orders of one site, at request time; nothing is stored.
  router.get("/procurement/replenishment-suggestions", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager"])) return;
    const parsed = replenishmentQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(response);
    if (refuseOutOfSiteScope(request, response, [parsed.data.siteId])) return;
    const { siteId, windowDays, coverDays, safetyDays, defaultLeadTimeDays } = parsed.data;
    const params = { windowDays, coverDays, safetyDays, defaultLeadTimeDays };
    try {
      const now = new Date();
      const inputs = await repository.replenishmentInputs({
        siteId,
        windowStart: new Date(now.getTime() - windowDays * DAY_MS),
        now,
      });
      return response.json({
        siteId,
        params,
        generatedAt: now.toISOString(),
        suggestions: replenishmentSuggestions({ ...inputs, params }),
      });
    } catch (error) {
      return next(error);
    }
  });
  // One Draft order per supplier, all or nothing. Every reference is checked in the catalog before the first write.
  router.post("/procurement/replenishment-suggestions/draft-orders", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager"])) return;
    const parsed = createReplenishmentDraftOrdersRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    const { siteId, orders } = parsed.data;
    if (refuseOutOfSiteScope(request, response, [siteId])) return;
    try {
      await assertCatalogReferences(
        options.catalogServiceUrl,
        signCatalogIdentity(request),
        orders.map((order) => order.supplierId),
        siteId,
        orders.flatMap((order) => order.lines.map((line) => line.productId)),
      );
      const purchaseOrders = await repository.createPurchaseOrders(
        orders.map((order) => ({
          supplierId: order.supplierId,
          siteId,
          createdBy: actor(request),
          notes: order.notes ? order.notes : REPLENISHMENT_DRAFT_NOTE,
          lines: order.lines,
        })),
      );
      return response.status(201).json({ purchaseOrders });
    } catch (error) {
      return next(error);
    }
  });
  router.post("/procurement/purchase-orders/:id/action", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager"])) return;
    const id = idSchema.safeParse(request.params);
    const parsed = purchaseOrderActionSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const current = await repository.getPurchaseOrder(id.data.id);
      if (!current) return response.status(404).json({ title: "Purchase order not found", status: 404 });
      if (refuseOutOfSiteScope(request, response, [current.siteId])) return;
      // Approval belongs to someone other than the creator; cancelling needs no second person.
      if (parsed.data.action === "approve" && refuseSelfApproval(request, response, current.createdBy)) return;
      const order =
        parsed.data.notes === undefined
          ? await repository.transition(id.data.id, parsed.data.action, actor(request))
          : await repository.transition(id.data.id, parsed.data.action, actor(request), parsed.data.notes);
      if (!order) return response.status(404).json({ title: "Purchase order not found", status: 404 });
      return response.json(order);
    } catch (error) {
      return next(error);
    }
  });
  router.get("/procurement/goods-receipts", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    const page = readPageRequest(request.query, listPage);
    if (!page) return invalidCursor(response);
    try {
      return sendPage(
        response,
        await repository.listReceipts({ siteIds: listSiteIds(request), q: readSearchText(request.query) }, page),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/procurement/goods-receipts/count", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    try {
      return response.json({
        count: await repository.countReceipts({ siteIds: listSiteIds(request), q: readSearchText(request.query) }),
      });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/procurement/goods-receipts/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const receipt = await repository.getReceipt(id.data.id);
      if (!receipt) return response.status(404).json({ title: "Goods receipt not found", status: 404 });
      if (refuseOutOfSiteScope(request, response, [receipt.siteId])) return;
      return response.json(receipt);
    } catch (error) {
      return next(error);
    }
  });
  router.post("/procurement/goods-receipts", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    const parsed = createGoodsReceiptRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    if (refuseOutOfSiteScope(request, response, [parsed.data.siteId])) return;
    try {
      // A receipt that links an order must lie within the scope of that order's site too.
      if (parsed.data.purchaseOrderId) {
        const order = await repository.getPurchaseOrder(parsed.data.purchaseOrderId);
        if (order && refuseOutOfSiteScope(request, response, [order.siteId])) return;
      }
      await assertCatalogReferences(
        options.catalogServiceUrl,
        signCatalogIdentity(request),
        [parsed.data.supplierId],
        parsed.data.siteId,
        parsed.data.lines.map((line) => line.productId),
        parsed.data.storageLocationId,
      );
      return response.status(201).json(
        await repository.createReceipt({
          ...parsed.data,
          createdBy: actor(request),
          receivedAt: new Date(parsed.data.receivedAt),
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  return router;
};

const unavailable = (response: import("express").Response) =>
  response.status(503).json({ title: "Procurement database is not configured", status: 503 });
const invalid = (response: import("express").Response) =>
  response.status(400).json({ title: "Invalid procurement request", status: 400, code: "invalid_request" });
// The catalog answers suppliers, sites and locations to a signed employee only, so each lookup carries the identity of the
// employee who is writing, next to the service secret.
const assertCatalogReferences = async (
  baseUrl: string,
  identity: string,
  supplierIds: string[],
  siteId: string,
  productIds: string[],
  storageLocationId?: string,
): Promise<void> => {
  const paths = [
    ...[...new Set(supplierIds)].map((supplierId) => `/suppliers/${supplierId}`),
    `/sites/${siteId}`,
    ...(storageLocationId ? [`/storage-locations/${storageLocationId}`] : []),
    ...[...new Set(productIds)].map((id) => `/products/${id}`),
  ];
  const responses = await Promise.all(
    paths.map((path) =>
      fetch(`${baseUrl}${path}`, {
        headers: { ...internalServiceHeaders(), "x-internal-identity-context": identity },
        signal: AbortSignal.timeout(2_000),
      }),
    ),
  );
  if (responses.some((response) => !response.ok)) throw new Error("Catalog reference validation failed");
};
