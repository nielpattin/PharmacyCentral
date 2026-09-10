import { Router } from "express";
import { z } from "zod";

import {
  createGoodsReceiptRequestSchema,
  createPurchaseOrderRequestSchema,
  purchaseOrderActionSchema,
} from "../contracts/procurement.ts";
import { internalServiceHeaders } from "../internal-service-headers.ts";

import { ProcurementRepository } from "./procurement-repository.ts";

const idSchema = z.object({ id: z.string().uuid() });
const actor = (request: import("express").Request): string =>
  request.header("X-Actor-Id") ?? "00000000-0000-0000-0000-000000000001";

export const createProcurementRouter = (repository: ProcurementRepository | undefined): Router => {
  const router = Router();
  router.get("/procurement/purchase-orders", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(
        await repository.listPurchaseOrders(
          typeof request.query.siteId === "string" ? request.query.siteId : undefined,
          typeof request.query.status === "string" ? request.query.status : undefined,
          queryLimit(request.query.limit),
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/procurement/purchase-orders/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const order = await repository.getPurchaseOrder(id.data.id);
      if (!order) return response.status(404).json({ title: "Purchase order not found", status: 404 });
      return response.json(order);
    } catch (error) {
      return next(error);
    }
  });
  router.post("/procurement/purchase-orders", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = createPurchaseOrderRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      await assertCatalogReferences(
        parsed.data.supplierId,
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
  router.post("/procurement/purchase-orders/:id/action", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    const parsed = purchaseOrderActionSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
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
    try {
      return response.json(
        await repository.listReceipts(
          typeof request.query.siteId === "string" ? request.query.siteId : undefined,
          queryLimit(request.query.limit),
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/procurement/goods-receipts/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const receipt = await repository.getReceipt(id.data.id);
      return receipt
        ? response.json(receipt)
        : response.status(404).json({ title: "Goods receipt not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  router.post("/procurement/goods-receipts", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = createGoodsReceiptRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      await assertCatalogReferences(
        parsed.data.supplierId,
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
const queryLimit = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 100;
};

const assertCatalogReferences = async (
  supplierId: string,
  siteId: string,
  productIds: string[],
  storageLocationId?: string,
): Promise<void> => {
  const baseUrl = process.env.CATALOG_SERVICE_URL ?? "http://localhost:3002";
  const paths = [
    `/suppliers/${supplierId}`,
    `/sites/${siteId}`,
    ...(storageLocationId ? [`/storage-locations/${storageLocationId}`] : []),
    ...productIds.map((id) => `/products/${id}`),
  ];
  const responses = await Promise.all(
    paths.map((path) =>
      fetch(`${baseUrl}${path}`, { headers: internalServiceHeaders(), signal: AbortSignal.timeout(2_000) }),
    ),
  );
  if (responses.some((response) => !response.ok)) throw new Error("Catalog reference validation failed");
};
