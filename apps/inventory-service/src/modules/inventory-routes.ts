import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  consumeReservationCommandSchema,
  dispenseStockCommandSchema,
  reserveStockCommandSchema,
  stockMovementCommandSchema,
} from "../contracts/inventory.ts";
import { listSiteIds } from "../middleware/trusted-request.ts";

import {
  actorIdOf,
  allowRoles,
  ownRequestsOnly,
  refuseRole,
  refuseOutOfSiteScope,
  refuseSelfApproval,
  refuseUnlessAnySiteInScope,
} from "./access-control.ts";
import { InventoryRepository, StockDispenseError } from "./inventory-repository.ts";
import { invalidCursor, sendPage } from "./keyset-page.ts";
import { readCommaList, readPageRequest, readSearchText, type PageOptions } from "./page-cursor.ts";
import { DEAD_STOCK_DAYS, MAX_DISPENSE_COST_ROWS } from "./stock-health.ts";
import { InsufficientStockError } from "./stock/application/fefo-allocate.ts";
import {
  TRANSFER_KEEP_COVER_DAYS,
  TRANSFER_TARGET_COVER_DAYS,
  TRANSFER_TRIGGER_COVER_DAYS,
  TRANSFER_WINDOW_DAYS,
  transferSuggestions,
} from "./transfer-suggestions.ts";

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
const disposalLineSchema = z.object({
  productBatchId: z.string().uuid(),
  storageLocationId: z.string().uuid(),
  quantity: z.number().positive(),
});
const disposalSchema = z
  .object({
    siteId: z.string().uuid(),
    reason: z.enum(["Expired", "Damaged", "Recalled", "Other"]),
    note: z.string().trim().max(2000).nullable().optional(),
    lines: z.array(disposalLineSchema).min(1).max(50),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, line] of value.lines.entries()) {
      const key = `${line.productBatchId}:${line.storageLocationId}`;
      if (seen.has(key))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", index],
          message: "A batch at a storage location appears once",
        });
      seen.add(key);
    }
  });
const disposalDecisionSchema = z.object({ decisionNotes: z.string().trim().max(1000).nullable().optional() });
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
const transferSuggestionQuerySchema = z.object({
  destinationSiteId: z.string().uuid().optional(),
  windowDays: z.coerce.number().int().min(7).max(180).default(TRANSFER_WINDOW_DAYS),
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
const DAY_MS = 24 * 60 * 60 * 1000;
const periodSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
/** The stock-health period: both ends are instants, `from` inclusive and `to` exclusive, and `from` comes first. */
const stockHealthPeriodSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .refine((period) => Date.parse(period.from) < Date.parse(period.to));

/** The dispense-cost window: the instant the first sale of interest was handed over. */
const dispenseCostWindowSchema = z.object({ since: z.string().datetime({ offset: true }) });

/** Status lists answer 100 rows by default, newest first, and at most 500 per page. */
const statusListPage: PageOptions = { kind: "timestamp", defaultLimit: 100, maxLimit: 500 };
/** The ledger answers 500 rows by default, as it always has. */
const ledgerPage: PageOptions = { kind: "timestamp", defaultLimit: 500, maxLimit: 500 };
/** Balances and batches answer every row, in expiry order, unless a `limit` or `cursor` asks for a page. */
const expiryPage: PageOptions = { kind: "date", defaultLimit: 100, maxLimit: 500, allWithoutLimit: true };
/** Returns answer every row, newest first, unless a `limit` or `cursor` asks for a page. */
const returnPage: PageOptions = { kind: "timestamp", defaultLimit: 100, maxLimit: 500, allWithoutLimit: true };

export const createInventoryRouter = (
  repository: InventoryRepository | undefined,
  dispenseCostRowLimit = MAX_DISPENSE_COST_ROWS,
): Router => {
  const router = Router();
  router.get("/inventory/balances", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const page = readPageRequest(request.query, expiryPage);
    if (!page) return invalidCursor(response);
    try {
      return sendPage(
        response,
        await repository.listBalances(
          {
            productId: typeof request.query.productId === "string" ? request.query.productId : undefined,
            siteIds: listSiteIds(request),
            storageLocationId:
              typeof request.query.storageLocationId === "string" ? request.query.storageLocationId : undefined,
            includeZeroBalances: request.query.includeZeroBalances !== "false",
            q: readSearchText(request.query),
          },
          page,
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/batches", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacist", "Pharmacy Manager", "Warehouse Staff"])) return;
    const page = readPageRequest(request.query, expiryPage);
    if (!page) return invalidCursor(response);
    try {
      return sendPage(
        response,
        await repository.listBatches(
          {
            productId: typeof request.query.productId === "string" ? request.query.productId : undefined,
            q: readSearchText(request.query),
            siteIds: listSiteIds(request),
          },
          page,
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/batches", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    const parsed = batchSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      return response.status(201).json(
        await repository.createBatch({
          ...parsed.data,
          qualityReviewedBy: undefined,
          qualityReviewedAt: undefined,
          createdBy: actorIdOf(request) ?? null,
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/batches/:id/quality", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacist", "Pharmacy Manager"])) return;
    const id = idParam.safeParse(request.params);
    const parsed = qualitySchema.safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const batch = await repository.getBatch(id.data.id);
      if (!batch) return response.status(404).json({ title: "Batch not found", status: 404 });
      // A verdict covers every site that holds the batch, so each of them must be the caller's.
      if (refuseOutOfSiteScope(request, response, await repository.batchSiteIds(batch.id))) return;
      if (refuseSelfApproval(request, response, batch.createdBy)) return;
      const reviewed = await repository.reviewBatch(
        id.data.id,
        parsed.data.decision === "release" ? "Released" : "Rejected",
        parsed.data.notes,
        request.header("X-Actor-Id") ?? undefined,
      );
      if (!reviewed) return response.status(404).json({ title: "Batch not found", status: 404 });
      return response.json(reviewed);
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/adjustments", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    const page = readPageRequest(request.query, statusListPage);
    if (!page) return invalidCursor(response);
    try {
      return sendPage(response, await repository.listAdjustments(statusListFilters(request), page));
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/adjustments/count", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    try {
      return response.json({ count: await repository.countAdjustments(statusListFilters(request)) });
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/adjustments", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    const parsed = adjustmentSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    if (refuseOutOfSiteScope(request, response, [parsed.data.siteId])) return;
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
    if (!allowRoles(request, response, ["Pharmacy Manager"])) return;
    const id = idParam.safeParse(request.params);
    const action = z.enum(["approve", "reject"]).safeParse(request.params.action);
    const notes = z.object({ approvalNotes: z.string().max(500).optional() }).safeParse(request.body);
    if (!id.success || !action.success || !notes.success) return invalid(response);
    try {
      const adjustment = await repository.getAdjustment(id.data.id);
      if (!adjustment) return response.status(404).json({ title: "Adjustment not found", status: 404 });
      if (refuseOutOfSiteScope(request, response, [adjustment.siteId])) return;
      if (refuseSelfApproval(request, response, adjustment.createdBy)) return;
      const decided = await repository.transitionAdjustment(
        id.data.id,
        action.data,
        request.header("X-Actor-Id") ?? "00000000-0000-0000-0000-000000000000",
        notes.data.approvalNotes,
      );
      return decided
        ? response.json(decided)
        : response.status(404).json({ title: "Adjustment not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/disposals", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacist", "Pharmacy Manager", "Warehouse Staff"])) return;
    const page = readPageRequest(request.query, statusListPage);
    if (!page) return invalidCursor(response);
    try {
      return sendPage(response, await repository.listDisposals(statusListFilters(request), page));
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/disposals", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacist", "Warehouse Staff"])) return;
    const parsed = disposalSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    if (refuseOutOfSiteScope(request, response, [parsed.data.siteId])) return;
    try {
      return response.status(201).json(
        await repository.createDisposal({
          ...parsed.data,
          createdBy: request.header("X-Actor-Id") ?? "00000000-0000-0000-0000-000000000000",
        }),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/disposals/:id/:action", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager"])) return;
    const id = idParam.safeParse(request.params);
    const action = z.enum(["approve", "reject"]).safeParse(request.params.action);
    const decision = disposalDecisionSchema.safeParse(request.body);
    if (!id.success || !action.success || !decision.success) return invalid(response);
    try {
      const record = await repository.getDisposal(id.data.id);
      if (!record) return response.status(404).json({ title: "Disposal record not found", status: 404 });
      if (refuseOutOfSiteScope(request, response, [record.siteId])) return;
      if (refuseSelfApproval(request, response, record.createdBy)) return;
      const decided = await repository.transitionDisposal(
        id.data.id,
        action.data,
        request.header("X-Actor-Id") ?? "00000000-0000-0000-0000-000000000000",
        decision.data.decisionNotes,
      );
      return decided
        ? response.json(decided)
        : response.status(404).json({ title: "Disposal record not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/movements/summary", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
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
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    const page = readPageRequest(request.query, ledgerPage);
    if (!page) return invalidCursor(response);
    const period = periodSchema.safeParse(request.query);
    if (!period.success) return invalid(response);
    try {
      return sendPage(
        response,
        await repository.listMovements(
          {
            productId: typeof request.query.productId === "string" ? request.query.productId : undefined,
            productBatchId: typeof request.query.productBatchId === "string" ? request.query.productBatchId : undefined,
            siteIds: listSiteIds(request),
            storageLocationId:
              typeof request.query.storageLocationId === "string" ? request.query.storageLocationId : undefined,
            ...(period.data.from ? { from: new Date(period.data.from) } : {}),
            ...(period.data.to ? { to: new Date(period.data.to) } : {}),
          },
          page,
        ),
      );
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/movements", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
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
    if (refuseOutOfSiteScope(request, response, [parsed.data.siteId])) return;
    try {
      return response
        .status(201)
        .json(await repository.recordMovement({ ...parsed.data, createdBy: actorIdOf(request) }));
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
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    const page = readPageRequest(request.query, statusListPage);
    if (!page) return invalidCursor(response);
    try {
      return sendPage(response, await repository.listTransfers(statusListFilters(request), page));
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/transfers/count", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    try {
      return response.json({ count: await repository.countTransfers(statusListFilters(request)) });
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
      if (!transfer) return response.status(404).json({ title: "Transfer not found", status: 404 });
      if (refuseUnlessAnySiteInScope(request, response, [transfer.sourceSiteId, transfer.destinationSiteId])) return;
      return response.json(transfer);
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/transfers", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    const parsed = transferSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    // Creating a transfer needs both of its sites in scope, not only one of them.
    if (refuseOutOfSiteScope(request, response, [parsed.data.sourceSiteId, parsed.data.destinationSiteId])) return;
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
      const current = await repository.getTransfer(id.data.id);
      if (!current) return response.status(404).json({ title: "Transfer not found", status: 404 });
      if (!transferActionAllowed(request, response, action.data, current)) return;
      const lineCommands = lines.data.lines?.map((line) => ({
        transferOrderLineId: line.transferOrderLineId,
        quantity: action.data === "ship" ? (line.shippedQuantity ?? 0) : (line.receivedQuantity ?? 0),
      }));
      const transfer = await repository.transitionTransfer(
        id.data.id,
        action.data,
        actorIdOf(request) ?? null,
        lineCommands,
      );
      if (!transfer) return response.status(404).json({ title: "Transfer not found", status: 404 });
      return response.json(transfer);
    } catch (error) {
      return next(error);
    }
  });
  // Transfer suggestions are computed from the sellable shelf and the sales ledger at request time; nothing is stored.
  router.get("/inventory/transfer-suggestions", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    const parsed = transferSuggestionQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(response);
    const { destinationSiteId, windowDays } = parsed.data;
    if (destinationSiteId !== undefined && refuseOutOfSiteScope(request, response, [destinationSiteId])) return;
    try {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const positions = await repository.transferPositions({
        siteIds: listSiteIds(request),
        windowStart: new Date(now.getTime() - windowDays * DAY_MS),
        today,
      });
      const suggestions = transferSuggestions({ positions, windowDays, today });
      return response.json({
        generatedAt: now.toISOString(),
        windowDays,
        params: {
          keepCoverDays: TRANSFER_KEEP_COVER_DAYS,
          triggerCoverDays: TRANSFER_TRIGGER_COVER_DAYS,
          targetCoverDays: TRANSFER_TARGET_COVER_DAYS,
        },
        suggestions:
          destinationSiteId === undefined
            ? suggestions
            : suggestions.filter((suggestion) => suggestion.destinationSiteId === destinationSiteId),
      });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/stocktakes", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    const page = readPageRequest(request.query, statusListPage);
    if (!page) return invalidCursor(response);
    try {
      return sendPage(response, await repository.listStocktakes(statusListFilters(request), page));
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/stocktakes/count", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    try {
      return response.json({ count: await repository.countStocktakes(statusListFilters(request)) });
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
      if (!stocktake) return response.status(404).json({ title: "Stocktake not found", status: 404 });
      if (refuseOutOfSiteScope(request, response, [stocktake.siteId])) return;
      return response.json(stocktake);
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/stocktakes", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    const parsed = stocktakeSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    if (refuseOutOfSiteScope(request, response, [parsed.data.siteId])) return;
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
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    const id = idParam.safeParse(request.params);
    const parsed = countSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const existing = await repository.findStocktakeLine(id.data.id);
      if (!existing) return response.status(404).json({ title: "Stocktake line not found", status: 404 });
      const session = await repository.getStocktake(existing.stocktakeId);
      if (!session) return response.status(404).json({ title: "Stocktake not found", status: 404 });
      if (refuseOutOfSiteScope(request, response, [session.siteId])) return;
      const line = await repository.countStocktakeLine(
        id.data.id,
        parsed.data.countedQuantity,
        actorIdOf(request) ?? null,
      );
      if (!line) return response.status(404).json({ title: "Stocktake line not found", status: 404 });
      return response.json(line);
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/stocktakes/:id/post", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager"])) return;
    const id = idParam.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const session = await repository.getStocktake(id.data.id);
      if (!session) return response.status(404).json({ title: "Stocktake not found", status: 404 });
      if (refuseOutOfSiteScope(request, response, [session.siteId])) return;
      // Nobody posts a session they counted in: a line the actor counted refuses the post.
      for (const line of session.lines) {
        if (refuseSelfApproval(request, response, line.countedBy)) return;
      }
      const stocktake = await repository.postStocktake(id.data.id, actorIdOf(request) ?? null);
      return stocktake
        ? response.json(stocktake)
        : response.status(404).json({ title: "Stocktake not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  router.get("/inventory/returns", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacy Manager", "Warehouse Staff"])) return;
    const page = readPageRequest(request.query, returnPage);
    if (!page) return invalidCursor(response);
    try {
      return sendPage(response, await repository.listReturns({ siteIds: listSiteIds(request) }, page));
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/returns", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Warehouse Staff"])) return;
    const parsed = returnSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    if (refuseOutOfSiteScope(request, response, [parsed.data.siteId])) return;
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
    if (!allowRoles(request, response, ["Pharmacist", "Pharmacy Manager", "Warehouse Staff"])) return;
    // A pharmacist reads only the requests they made.
    const ownOnly = ownRequestsOnly(request);
    const requester = actorIdOf(request);
    if (ownOnly && requester === undefined) return refuseRole(response);
    const page = readPageRequest(request.query, statusListPage);
    if (!page) return invalidCursor(response);
    try {
      return sendPage(
        response,
        await repository.listReplenishments(
          { ...statusListFilters(request), requestedBy: ownOnly ? requester : undefined },
          page,
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
      if (!replenishment) return response.status(404).json({ title: "Replenishment request not found", status: 404 });
      if (refuseOutOfSiteScope(request, response, [replenishment.siteId])) return;
      if (ownRequestsOnly(request) && actorIdOf(request) !== replenishment.requestedBy) return refuseRole(response);
      return response.json(replenishment);
    } catch (error) {
      return next(error);
    }
  });
  router.post("/inventory/replenishment", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!allowRoles(request, response, ["Pharmacist", "Pharmacy Manager"])) return;
    const parsed = replenishmentSchema.safeParse(request.body);
    const requestedBy = request.header("X-Actor-Id");
    if (!parsed.success || !requestedBy) return invalid(response);
    if (refuseOutOfSiteScope(request, response, [parsed.data.siteId])) return;
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
      const current = await repository.getReplenishment(id.data.id);
      if (!current) return response.status(404).json({ title: "Replenishment request not found", status: 404 });
      if (refuseOutOfSiteScope(request, response, [current.siteId])) return;
      if (!replenishmentActionAllowed(request, response, action.data, current.requestedBy)) return;
      const replenishment = await repository.transitionReplenishment(
        id.data.id,
        action.data,
        actorIdOf(request),
        review.data.reviewNotes ?? null,
      );
      return replenishment
        ? response.json(replenishment)
        : response.status(404).json({ title: "Replenishment request not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });
  // Stock health is read by operations-query over the service secret for its analytics page; no browser reaches it.
  router.get("/internal/analytics/stock-health", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (request.header("x-actor-type") !== "system")
      return response.status(403).json({ title: "System actor required", status: 403, code: "forbidden" });
    const period = stockHealthPeriodSchema.safeParse(request.query);
    if (!period.success) return invalid(response);
    const from = new Date(period.data.from);
    const to = new Date(period.data.to);
    const asOf = new Date();
    try {
      const rows = await repository.stockHealth({ from, to, siteIds: listSiteIds(request), asOf });
      return response.json({
        from: from.toISOString(),
        to: to.toISOString(),
        asOf: asOf.toISOString(),
        deadStockDays: DEAD_STOCK_DAYS,
        rows,
      });
    } catch (error) {
      return next(error);
    }
  });
  // What the goods of each sale cost, read by operations-query for gross profit; no browser reaches it.
  router.get("/internal/analytics/dispense-costs", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (request.header("x-actor-type") !== "system")
      return response.status(403).json({ title: "System actor required", status: 403, code: "forbidden" });
    const window = dispenseCostWindowSchema.safeParse(request.query);
    if (!window.success) return invalid(response);
    const since = new Date(window.data.since);
    try {
      const rows = await repository.dispenseCosts({ since, maxRows: dispenseCostRowLimit });
      if (rows.length > dispenseCostRowLimit)
        return response.status(422).json({
          title: "The period has too many sales to read",
          status: 422,
          code: "analytics_range_too_large",
        });
      return response.json({ since: since.toISOString(), rows });
    } catch (error) {
      return next(error);
    }
  });
  return router;
};

const unavailable = (response: Response) =>
  response.status(503).json({ title: "Inventory database is not configured", status: 503 });

type TransferRecord = { sourceSiteId: string; destinationSiteId: string; createdBy: string };

/**
 * The role, site and separation-of-duties checks of one transfer action. Approval is a Pharmacy Manager's and needs
 * the scope of either end, never by the creator; shipping is Warehouse Staff at the source and receiving at the
 * destination; cancelling is Warehouse Staff or a Pharmacy Manager at the source. Sends the refusal and returns false.
 */
const transferActionAllowed = (
  request: Request,
  response: Response,
  action: "approve" | "ship" | "receive" | "cancel",
  transfer: TransferRecord,
): boolean => {
  if (action === "approve") {
    if (!allowRoles(request, response, ["Pharmacy Manager"])) return false;
    if (refuseUnlessAnySiteInScope(request, response, [transfer.sourceSiteId, transfer.destinationSiteId]))
      return false;
    return !refuseSelfApproval(request, response, transfer.createdBy);
  }
  if (action === "ship" || action === "receive") {
    if (!allowRoles(request, response, ["Warehouse Staff"])) return false;
    const site = action === "ship" ? transfer.sourceSiteId : transfer.destinationSiteId;
    return !refuseOutOfSiteScope(request, response, [site]);
  }
  // Cancelling is allowed before shipment, at the source site, to Warehouse Staff or a Pharmacy Manager.
  if (!allowRoles(request, response, ["Warehouse Staff", "Pharmacy Manager"])) return false;
  return !refuseOutOfSiteScope(request, response, [transfer.sourceSiteId]);
};

/**
 * The role and separation-of-duties checks of one replenishment action. Approval, rejection and fulfilment belong to
 * Warehouse Staff and never to the requester; the requester (or Warehouse Staff) may cancel. Sends the refusal and
 * returns false.
 */
const replenishmentActionAllowed = (
  request: Request,
  response: Response,
  action: "approve" | "reject" | "cancel" | "fulfill",
  requestedBy: string,
): boolean => {
  if (action === "cancel") {
    if (actorIdOf(request) === requestedBy) return true;
    return allowRoles(request, response, ["Warehouse Staff"]);
  }
  if (!allowRoles(request, response, ["Warehouse Staff"])) return false;
  return !refuseSelfApproval(request, response, requestedBy);
};

const invalid = (response: Response) =>
  response.status(400).json({ title: "Invalid inventory request", status: 400, code: "invalid_request" });
/**
 * The site scope and the filters of a status list, shared by the list and its count. `status` and `excludeStatus`
 * take comma-separated values, so one count can cover several states.
 */
const statusListFilters = (request: Request) => ({
  siteIds: listSiteIds(request),
  statuses: readCommaList(request.query.status),
  excludeStatuses: readCommaList(request.query.excludeStatus),
  q: readSearchText(request.query),
});
