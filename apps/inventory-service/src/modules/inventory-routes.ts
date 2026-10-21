import { Router } from "express";
import { z } from "zod";

import {
  consumeReservationCommandSchema,
  dispenseStockCommandSchema,
  reserveStockCommandSchema,
  stockMovementCommandSchema,
} from "../contracts/inventory.ts";
import { listSiteIds } from "../middleware/trusted-request.ts";

import { InventoryRepository, StockDispenseError } from "./inventory-repository.ts";
import { InsufficientStockError } from "./stock/application/fefo-allocate.ts";

const idParam = z.object({ id: z.string().uuid() });
const batchSchema = z.object({
  productId: z.string().uuid(),
  supplierId: z.string().uuid().nullable().optional(),
  batchNumber: z.string().trim().min(1).max(100),
  manufacturedDate: z.string().date().nullable().optional(),
  expiryDate: z.string().date(),
  manufacturer: z.string().trim().max(300).nullable().optional(),
  status: z.string().trim().max(30).optional(),
  qualityStatus: z.enum(["PendingQc", "Released", "Rejected"]).optional(),
  qualityNotes: z.string().trim().max(1000).nullable().optional(),
});
const qualitySchema = z.object({
  decision: z.enum(["release", "reject"]),
  notes: z.string().trim().max(1000).nullable().optional(),
});
const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  productBatchId: z.string().uuid(),
  siteId: z.string().uuid(),
  storageLocationId: z.string().uuid(),
  adjustmentType: z.enum(["Positive", "Negative"]),
  quantity: z.number().positive(),
  reason: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(1000).nullable().optional(),
});
const replenishmentLineSchema = z.object({
  productId: z.string().uuid(),
  productBatchId: z.string().uuid(),
  requestedQuantity: z.number().positive(),
  reason: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
const replenishmentSchema = z.object({
  siteId: z.string().uuid(),
  storageLocationId: z.string().uuid(),
  notes: z.string().trim().max(2_000).nullable().optional(),
  lines: z.array(replenishmentLineSchema).min(1),
});
const transferLineSchema = z.object({
  productId: z.string().uuid(),
  productBatchId: z.string().uuid(),
  sourceStorageLocationId: z.string().uuid(),
  destinationStorageLocationId: z.string().uuid(),
  quantity: z.number().positive(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
const transferSchema = z.object({
  transferNumber: z.string().trim().min(1).max(100),
  sourceSiteId: z.string().uuid(),
  destinationSiteId: z.string().uuid(),
  lines: z.array(transferLineSchema).min(1),
});
const stocktakeSchema = z.object({
  siteId: z.string().uuid(),
  storageLocationId: z.string().uuid(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z
    .array(z.object({ productBatchId: z.string().uuid(), systemQuantity: z.number().nonnegative().optional() }))
    .min(1),
});
const returnLineSchema = z.object({
  productBatchId: z.string().uuid(),
  storageLocationId: z.string().uuid(),
  quantity: z.number().positive(),
  destination: z.string().trim().max(500).nullable().optional(),
  occurredAtUtc: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
const returnSchema = z.object({
  siteId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  lines: z.array(returnLineSchema).min(1),
});
const countSchema = z.object({ countedQuantity: z.number().nonnegative() });
const periodSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const createInventoryRouter = (repository: InventoryRepository | undefined): Router => {
  const router = Router();
  router.get("/inventory/balances", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(
        await repository.listBalances(
          typeof request.query.productId === "string" ? request.query.productId : undefined,
          listSiteIds(request),
          typeof request.query.storageLocationId === "string" ? request.query.storageLocationId : undefined,
          request.query.includeZeroBalances !== "false",
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/batches", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(
        await repository.listBatches(typeof request.query.productId === "string" ? request.query.productId : undefined),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/batches", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = batchSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      return response
        .status(201)
        .json(
          await repository.createBatch({ ...parsed.data, qualityReviewedBy: undefined, qualityReviewedAt: undefined }),
        );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/batches/:id/quality", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idParam.safeParse(request.params);
    const parsed = qualitySchema.safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const batch = await repository.reviewBatch(
        id.data.id,
        parsed.data.decision === "release" ? "Released" : "Rejected",
        parsed.data.notes,
        request.header("X-Actor-Id") ?? undefined,
      );
      if (!batch) return response.status(404).json({ title: "Batch not found", status: 404 });
      return response.json(batch);
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/adjustments", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(
        await repository.listAdjustments({
          siteIds: listSiteIds(request),
          status: typeof request.query.status === "string" ? request.query.status : undefined,
          limit: queryNumber(request.query.limit, 100),
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/adjustments", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = adjustmentSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      return response.status(201).json(
        await repository.createAdjustment({
          ...parsed.data,
          createdBy: request.header("X-Actor-Id") ?? "00000000-0000-0000-0000-000000000000",
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/adjustments/:id/:action", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idParam.safeParse(request.params);
    const action = z.enum(["approve", "reject"]).safeParse(request.params.action);
    const notes = z.object({ approvalNotes: z.string().max(500).optional() }).safeParse(request.body);
    if (!id.success || !action.success || !notes.success) return invalid(response);
    try {
      const adjustment = await repository.transitionAdjustment(
        id.data.id,
        action.data,
        request.header("X-Actor-Id") ?? "00000000-0000-0000-0000-000000000000",
        notes.data.approvalNotes,
      );
      return adjustment
        ? response.json(adjustment)
        : response.status(404).json({ title: "Adjustment not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/movements/summary", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const period = periodSchema.safeParse(request.query);
    if (!period.success) return invalid(response);
    try {
      return response.json(
        await repository.summarizeMovements({
          siteIds: listSiteIds(request),
          ...(period.data.from ? { from: new Date(period.data.from) } : {}),
          ...(period.data.to ? { to: new Date(period.data.to) } : {}),
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/movements", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(
        await repository.listMovements({
          productId: typeof request.query.productId === "string" ? request.query.productId : undefined,
          productBatchId: typeof request.query.productBatchId === "string" ? request.query.productBatchId : undefined,
          siteIds: listSiteIds(request),
          storageLocationId:
            typeof request.query.storageLocationId === "string" ? request.query.storageLocationId : undefined,
          limit: queryNumber(request.query.limit, 500),
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/movements", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = stockMovementCommandSchema
      .extend({
        productBatchId: z.string().uuid(),
        occurredAtUtc: z.string().datetime({ offset: true }).nullable().optional(),
        referenceType: z.string().trim().max(80).nullable().optional(),
        referenceId: z.string().uuid().nullable().optional(),
        notes: z.string().trim().max(1000).nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      return response
        .status(201)
        .json(
          await repository.recordMovement({ ...parsed.data, createdBy: request.header("X-Actor-Id") ?? undefined }),
        );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/reservations", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = reserveStockCommandSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    const actorId = request.header("X-Actor-Id");
    const ownerId = actorId ?? parsed.data.reservationId;
    try {
      return response.status(201).json({
        reservationId: parsed.data.reservationId,
        allocations: await repository.reserve({
          reservationId: parsed.data.reservationId,
          ownerId,
          siteId: parsed.data.sourceSiteId,
          storageLocationId: parsed.data.sourceLocationId,
          lines: parsed.data.lines,
        }),
      });
    } catch (error) {
      if (error instanceof InsufficientStockError)
        return response
          .status(409)
          .json({ title: "Stock could not be reserved", status: 409, code: "insufficient_stock" });
      return next(error);
    }
  });
  router.get("/inventory/reservations", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(
        await repository.listReservations(
          typeof request.query.ownerId === "string" ? request.query.ownerId : undefined,
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/reservations/:id/release", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idParam.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const reservation = await repository.releaseReservation(id.data.id);
      if (!reservation) return response.status(404).json({ title: "Reservation not found", status: 404 });
      return response.json(reservation);
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/reservations/:id/consume", async (request, response, next) => {
    if (!repository) return unavailable(response);
    // The goods of an order leave only when sales-service hands the order over, never from a browser.
    if (request.header("x-actor-type") !== "system")
      return response.status(403).json({ title: "System actor required", status: 403, code: "forbidden" });
    const id = idParam.safeParse(request.params);
    const parsed = consumeReservationCommandSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const reservation = await repository.consumeReservation(
        id.data.id,
        "Order",
        parsed.data.orderId,
        request.header("X-Actor-Id"),
      );
      if (!reservation) return response.status(404).json({ title: "Reservation not found", status: 404 });
      return response.json(reservation);
    } catch (error) {
      if (error instanceof StockDispenseError)
        return response.status(409).json({
          title: "Stock could not be handed over",
          status: 409,
          code: "dispense_rejected",
          detail: error.message,
        });
      return next(error);
    }
  });
  router.post("/inventory/dispenses", async (request, response, next) => {
    if (!repository) return unavailable(response);
    // Stock leaves only together with the sale that records it, so the dispense comes from sales-service, never a browser.
    if (request.header("x-actor-type") !== "system")
      return response.status(403).json({ title: "System actor required", status: 403, code: "forbidden" });
    const parsed = dispenseStockCommandSchema.safeParse(request.body);
    const actorId = request.header("X-Actor-Id");
    if (!parsed.success || !actorId) return invalid(response);
    try {
      return response.status(201).json(
        await repository.dispense({
          dispenseId: parsed.data.dispenseId,
          reservationId: parsed.data.reservationId,
          referenceId: parsed.data.prescriptionId,
          siteId: parsed.data.siteId,
          storageLocationId: parsed.data.storageLocationId,
          actorId,
          lines: parsed.data.lines,
        }),
      );
    } catch (error) {
      // The stock refused the goods; the caller rolls its own record back and shows the pharmacist why.
      if (error instanceof StockDispenseError)
        return response.status(409).json({
          title: "Stock could not be dispensed",
          status: 409,
          code: "dispense_rejected",
          detail: error.message,
        });
      return next(error);
    }
  });
  router.get("/inventory/transfers", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(
        await repository.listTransfers(
          listSiteIds(request),
          typeof request.query.status === "string" ? request.query.status : undefined,
          queryNumber(request.query.limit, 100),
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/transfers/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idParam.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const transfer = await repository.getTransfer(id.data.id);
      return transfer
        ? response.json(transfer)
        : response.status(404).json({ title: "Transfer not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/transfers", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = transferSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      return response.status(201).json(
        await repository.createTransfer({
          ...parsed.data,
          lines: parsed.data.lines.map((line) => ({ ...line, notes: line.notes ?? null })),
          createdBy: request.header("X-Actor-Id") ?? "00000000-0000-0000-0000-000000000000",
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/transfers/:id/:action", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idParam.safeParse(request.params);
    const action = z.enum(["approve", "ship", "receive", "cancel"]).safeParse(request.params.action);
    const lines = z
      .object({
        lines: z
          .array(
            z.object({
              transferOrderLineId: z.string().uuid(),
              shippedQuantity: z.number().positive().optional(),
              receivedQuantity: z.number().positive().optional(),
            }),
          )
          .optional(),
      })
      .safeParse(request.body);
    if (!id.success || !action.success || !lines.success) return invalid(response);
    try {
      const lineCommands = lines.data.lines?.map((line) => ({
        transferOrderLineId: line.transferOrderLineId,
        quantity: action.data === "ship" ? (line.shippedQuantity ?? 0) : (line.receivedQuantity ?? 0),
      }));
      const transfer =
        lineCommands === undefined
          ? await repository.transitionTransfer(id.data.id, action.data)
          : await repository.transitionTransfer(id.data.id, action.data, lineCommands);
      if (!transfer) return response.status(404).json({ title: "Transfer not found", status: 404 });
      return response.json(transfer);
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/stocktakes", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(
        await repository.listStocktakes(
          listSiteIds(request),
          typeof request.query.status === "string" ? request.query.status : undefined,
          queryNumber(request.query.limit, 100),
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/stocktakes/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idParam.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const stocktake = await repository.getStocktake(id.data.id);
      return stocktake
        ? response.json(stocktake)
        : response.status(404).json({ title: "Stocktake not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/stocktakes", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = stocktakeSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      return response.status(201).json(
        await repository.createStocktake({
          ...parsed.data,
          createdBy: request.header("X-Actor-Id") ?? "00000000-0000-0000-0000-000000000000",
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/stocktake-lines/:id/count", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idParam.safeParse(request.params);
    const parsed = countSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const line = await repository.countStocktakeLine(id.data.id, parsed.data.countedQuantity);
      if (!line) return response.status(404).json({ title: "Stocktake line not found", status: 404 });
      return response.json(line);
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/stocktakes/:id/post", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idParam.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const stocktake = await repository.postStocktake(id.data.id);
      return stocktake
        ? response.json(stocktake)
        : response.status(404).json({ title: "Stocktake not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/returns", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(await repository.listReturns(listSiteIds(request)));
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/returns", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = returnSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      return response.status(201).json(
        await repository.createReturn({
          ...parsed.data,
          createdBy: request.header("X-Actor-Id") ?? "00000000-0000-0000-0000-000000000000",
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/replenishment", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(
        await repository.listReplenishments(
          listSiteIds(request),
          typeof request.query.status === "string" ? request.query.status : undefined,
          queryNumber(request.query.limit, 100),
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/replenishment/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idParam.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const replenishment = await repository.getReplenishment(id.data.id);
      return replenishment
        ? response.json(replenishment)
        : response.status(404).json({ title: "Replenishment request not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/replenishment", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = replenishmentSchema.safeParse(request.body);
    const requestedBy = request.header("X-Actor-Id");
    if (!parsed.success || !requestedBy) return invalid(response);
    try {
      return response.status(201).json(
        await repository.createReplenishment({
          siteId: parsed.data.siteId,
          storageLocationId: parsed.data.storageLocationId,
          notes: parsed.data.notes ?? null,
          lines: parsed.data.lines.map((line) => ({ ...line, reason: line.reason ?? null, notes: line.notes ?? null })),
          requestedBy,
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/replenishment/:id/:action", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idParam.safeParse(request.params);
    const action = z.enum(["approve", "reject", "cancel", "fulfill"]).safeParse(request.params.action);
    const review = z
      .object({ reviewNotes: z.string().trim().max(1000).nullable().optional() })
      .optional()
      .default({})
      .safeParse(request.body);
    if (!id.success || !action.success || !review.success) return invalid(response);
    try {
      const replenishment =
        review.data.reviewNotes === undefined
          ? await repository.transitionReplenishment(id.data.id, action.data)
          : await repository.transitionReplenishment(
              id.data.id,
              action.data,
              request.header("X-Actor-Id") ?? undefined,
              review.data.reviewNotes,
            );
      return replenishment
        ? response.json(replenishment)
        : response.status(404).json({ title: "Replenishment request not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  return router;
};

const unavailable = (response: import("express").Response) =>
  response.status(503).json({ title: "Inventory database is not configured", status: 503 });
const invalid = (response: import("express").Response) =>
  response.status(400).json({ title: "Invalid inventory request", status: 400, code: "invalid_request" });
const queryNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};
