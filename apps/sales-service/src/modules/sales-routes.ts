import { createHash, randomUUID } from "node:crypto";

import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import {
  cartLineSchema,
  createOrderRequestSchema,
  createPrescriptionRequestSchema,
  dispensePrescriptionRequestSchema,
  mergeCartRequestSchema,
  orderTransitionSchema,
  salesDocumentsQuerySchema,
  salesTargetMonthSchema,
  setSalesTargetSchema,
} from "../contracts/sales.ts";
import { idempotencyKeySchema } from "../contracts/common.ts";
import { internalServiceHeaders } from "../internal-service-headers.ts";
import { actorSiteIds, listSiteIds } from "../middleware/trusted-request.ts";
import { readCursorParam } from "../shared/page-cursor.ts";
import { invalidCursor, pagedListQuery, sendPage } from "../shared/presentation/page-response.ts";
import { sendDatabaseUnavailable as unavailable } from "../shared/presentation/database-unavailable.ts";

import {
  DeliveryOutOfRangeError,
  type DeliveryCalculation,
  type DeliveryCalculator,
} from "./delivery/domain/delivery-calculator.ts";
import { CustomerContactUnavailableError, lookupCustomerContacts } from "./customer-contact.ts";
import type { OrderStock } from "./orders/application/order-stock.ts";
import { orderRequestFingerprint } from "./orders/domain/order-request-fingerprint.ts";
import {
  InvalidOrderTransition,
  staffMoveRefusal,
  transitionOrder as assertOrderTransition,
  type OrderStatus,
} from "./orders/domain/order-status.ts";
import { InsufficientStockError, InventoryRequestError } from "./orders/infrastructure/inventory-reservations.ts";
import {
  IdempotencyKeyInUseError,
  PrescriptionDispenseError,
  SalesRepository,
  type PrescriptionStockDispense,
} from "./sales-repository.ts";
import { actorMaySeeSite, siteAccessDenied } from "./staff-access.ts";

const idSchema = z.object({ id: z.string().uuid() });
/** `PATCH /carts/selection` ticks or unticks the named lines, or every line when `lineIds` is left out. */
const cartSelectionSchema = z.object({
  selected: z.boolean(),
  lineIds: z.array(z.string().uuid()).min(1).max(200).optional(),
});
/** The prescription states a caller may name in `excludeStatus`, as stored. */
const prescriptionStatuses = ["Draft", "Pending", "PartiallyDispensed", "Dispensed", "Cancelled"] as const;
const excludeStatusParam = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(",")
          .map((status) => status.trim())
          .filter((status) => status.length > 0)
      : [],
  )
  .pipe(z.array(z.enum(prescriptionStatuses)));
const actor = (request: Request): string | undefined => request.header("X-Actor-Id") ?? undefined;
/** Pharmacy staff and internal services work across customers; a shopper only ever reads their own rows. */
const isStaffActor = (request: Request): boolean => {
  const type = request.header("X-Actor-Type");
  return type === "employee" || type === "system";
};
/** Adds each row's shopper name and phone, read from identity, for a caller who may see them. Throws when identity fails. */
const withCustomerContacts = async <T extends { customerId: string }>(
  rows: readonly T[],
  baseUrl: string | undefined,
) => {
  const contacts = await lookupCustomerContacts(
    rows.map((row) => row.customerId),
    baseUrl,
  );
  return rows.map((row) => {
    const contact = contacts.get(row.customerId);
    return {
      ...row,
      customer: contact ? { displayName: contact.displayName, phoneNumber: contact.phoneNumber } : null,
    };
  });
};

export type SalesRouterOptions = {
  /** Both URLs are validated at boot by main.ts, so a missing one is a type error and never a localhost guess. */
  catalogServiceUrl: string;
  inventoryServiceUrl: string;
  /** Absent exactly when the database is, and then the routes that hold or hand over stock answer 503. */
  orderStock?: OrderStock | undefined;
  identityServiceUrl?: string | undefined;
  deliveryCalculator?: DeliveryCalculator | undefined;
  lookupStore?: (storeId: string) => Promise<{ id: string; latitude: number; longitude: number } | undefined>;
};

export const createSalesRouter = (repository: SalesRepository | undefined, options: SalesRouterOptions): Router => {
  const router = Router();

  router.get("/carts", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    if (!customerId) return unauthorized(response);
    try {
      return response.json(await repository.getOrCreateCart(customerId));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/carts/lines", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    if (!customerId) return unauthorized(response);
    const parsed = cartLineSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      const [prescriptionId] = await findPrescriptionProductIds([parsed.data.productId], options.catalogServiceUrl);
      if (prescriptionId) return response.status(409).json(prescriptionProblem(prescriptionId));
      return response.status(201).json(await repository.addCartLine(customerId, parsed.data));
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/carts", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    if (!customerId) return unauthorized(response);
    try {
      return response.json(await repository.clearCart(customerId));
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/carts/lines/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    if (!customerId) return unauthorized(response);
    const id = idSchema.safeParse(request.params);
    const parsed = z.object({ quantity: z.number().nonnegative() }).safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const cart = await repository.updateCartLine(customerId, id.data.id, parsed.data.quantity);
      return cart ? response.json(cart) : response.status(404).json({ title: "Cart not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/carts/selection", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    if (!customerId) return unauthorized(response);
    const parsed = cartSelectionSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      const cart = await repository.setCartSelection(customerId, parsed.data.selected, parsed.data.lineIds);
      return cart ? response.json(cart) : response.status(404).json({ title: "Cart not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/carts/merge", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    if (!customerId) return unauthorized(response);
    const parsed = mergeCartRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      // A prescription-only line never enters the cart (BR-ORD-011). It can only arrive from a browser cart written
      // before the rule, so it is dropped here and the other lines still merge.
      const prescriptionIds = await findPrescriptionProductIds(
        parsed.data.lines.map((line) => line.productId),
        options.catalogServiceUrl,
      );
      const lines = parsed.data.lines.filter((line) => !prescriptionIds.has(line.productId));
      return response.json(await repository.mergeLocalCart(customerId, lines));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/delivery/addresses", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    if (!customerId) return unauthorized(response);
    try {
      return response.json(await repository.listDeliveryAddresses(customerId));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/delivery/addresses", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    if (!customerId) return unauthorized(response);
    const parsed = z
      .object({
        label: z.string().trim().min(1).max(100),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        providerResolvedAddress: z.string().trim().min(1).max(2_000),
        addressNote: z.string().trim().max(500).nullable().optional(),
        isDefault: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      return response.status(201).json(
        await repository.createDeliveryAddress({
          ...parsed.data,
          customerId,
          addressNote: parsed.data.addressNote ?? null,
        }),
      );
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/delivery/addresses/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    const id = idSchema.safeParse(request.params);
    if (!customerId) return unauthorized(response);
    if (!id.success) return invalid(response);
    const parsed = z
      .object({
        label: z.string().trim().min(1).max(100).optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        providerResolvedAddress: z.string().trim().min(1).max(2_000).optional(),
        addressNote: z.string().trim().max(500).nullable().optional(),
        isDefault: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      const address = await repository.updateDeliveryAddress(customerId, id.data.id, parsed.data);
      return address
        ? response.json(address)
        : response.status(404).json({ title: "Delivery address not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/delivery/addresses/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    const id = idSchema.safeParse(request.params);
    if (!customerId) return unauthorized(response);
    if (!id.success) return invalid(response);
    try {
      const address = await repository.deleteDeliveryAddress(customerId, id.data.id);
      return address
        ? response.status(204).end()
        : response.status(404).json({ title: "Delivery address not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/orders", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const requesterId = actor(request);
    if (!requesterId) return unauthorized(response);
    const query = pagedListQuery.safeParse(request.query);
    const cursor = readCursorParam(request.query.cursor);
    if (!query.success) return invalid(response);
    if (!cursor.ok) return invalidCursor(response);
    const status = queryString(request.query.status);
    const { limit, q } = query.data;
    try {
      // Staff see the orders of their assigned sites, optionally narrowed to one site or payment
      // state. A shopper only reads their own orders.
      if (isStaffActor(request)) {
        const page = await repository.listOrders({
          status,
          limit,
          q,
          after: cursor.cursor,
          paymentStatus: queryString(request.query.paymentStatus),
          siteIds: listSiteIds(request),
        });
        // A shopper's name and phone reach an employee only (Decision 14); the edge and trusted layer set the roles.
        if (request.header("X-Actor-Type") !== "employee") return sendPage(response, page);
        return sendPage(response, {
          ...page,
          rows: await withCustomerContacts(page.rows, options.identityServiceUrl),
        });
      }
      return sendPage(
        response,
        await repository.listOrders({ customerId: requesterId, status, limit, q, after: cursor.cursor }),
      );
    } catch (error) {
      if (error instanceof CustomerContactUnavailableError) return identityUnavailable(response);
      return next(error);
    }
  });

  router.get("/orders/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    const customerId = actor(request);
    if (!id.success) return invalid(response);
    if (!customerId) return unauthorized(response);
    try {
      const order = await repository.getOrder(id.data.id);
      if (isStaffActor(request)) {
        // An order at another site is not found to this staff member, the same answer as a missing order.
        if (!order || !actorMaySeeSite(request, order.selectedStoreId))
          return response.status(404).json({ title: "Order not found", status: 404 });
        if (request.header("X-Actor-Type") !== "employee") return response.json(order);
        const [withContact] = await withCustomerContacts([order], options.identityServiceUrl);
        return response.json(withContact);
      }
      if (!order || order.customerId !== customerId)
        return response.status(404).json({ title: "Order not found", status: 404 });
      return response.json(order);
    } catch (error) {
      if (error instanceof CustomerContactUnavailableError) return identityUnavailable(response);
      return next(error);
    }
  });

  router.post("/orders", async (request, response, next) => {
    const orderStock = options.orderStock;
    if (!repository || !orderStock) return unavailable(response);
    const customerId = actor(request);
    const parsed = createOrderRequestSchema.safeParse(request.body);
    if (!customerId) return unauthorized(response);
    if (!parsed.success) return invalid(response);
    // The Idempotency-Key is optional. Sent, a repeat of it answers the order it created (see answerRepeatedOrder).
    const keyHeader = request.header("Idempotency-Key");
    const keyParsed = keyHeader === undefined ? undefined : idempotencyKeySchema.safeParse(keyHeader);
    if (keyParsed && !keyParsed.success) return invalid(response);
    const idempotency = keyParsed?.success
      ? { key: keyParsed.data, requestHash: orderRequestFingerprint(parsed.data) }
      : undefined;
    try {
      if (idempotency && (await answerRepeatedOrder(response, repository, customerId, idempotency))) return;
      // An order made from the cart takes its lines from the server's copy, never from the request (BR-CART-002).
      const cartLines = parsed.data.fromCart ? await repository.getSelectedCartLines(customerId) : undefined;
      if (cartLines?.length === 0)
        return response
          .status(409)
          .json({ title: "No cart line is selected for this order", status: 409, code: "cart_selection_empty" });
      const requested = cartLines ?? parsed.data.lines;
      if (!requested) return invalid(response);
      const lines = await resolveOrderLines(requested, options.catalogServiceUrl);
      const subtotal = lines.reduce((total, line) => total + line.unitPriceSnapshot * line.quantity, 0);
      let delivery: DeliveryCalculation | undefined;
      if (parsed.data.fulfillmentType === "delivery") {
        if (!parsed.data.delivery || !options.deliveryCalculator)
          return response
            .status(503)
            .json({ title: "Delivery provider is not configured", status: 503, code: "delivery_unavailable" });
        const store = options.lookupStore ? await options.lookupStore(parsed.data.selectedStoreId) : undefined;
        if (!store)
          return response.status(404).json({ title: "Selected store not found", status: 404, code: "store_not_found" });
        delivery = await options.deliveryCalculator.calculate({
          store,
          destination: parsed.data.delivery.destination,
          addressNote: parsed.data.delivery.addressNote,
        });
      }
      const order = await repository.createOrder({
        customerId,
        selectedStoreId: parsed.data.selectedStoreId,
        fulfillmentType: parsed.data.fulfillmentType,
        subtotal: roundMoney(subtotal),
        deliveryFee: parsed.data.fulfillmentType === "pickup" ? 0 : (delivery?.fee ?? 0),
        currency: "VND",
        paymentMethod: parsed.data.paymentMethod,
        lines,
        ...(delivery ? { delivery: toDeliverySnapshot(delivery) } : {}),
        idempotency,
      });
      try {
        await orderStock.hold(
          order,
          lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        );
      } catch (error) {
        // The order was cancelled because its stock was refused. Its key must not replay that cancelled order, so a
        // retry with the same key places a new one.
        if (idempotency) await repository.deleteOrderIdempotencyKey(customerId, idempotency.key, order.id);
        throw error;
      }
      // Only after the stock is held: a refused order leaves the cart as it was. The lines that were not ticked stay.
      if (cartLines)
        await repository.clearCart(
          customerId,
          cartLines.map((line) => line.id),
        );
      return response.status(201).json(await repository.getOrder(order.id));
    } catch (error) {
      // A concurrent duplicate lost the race for its key: its order insert was rolled back, so the winner's order is
      // the answer.
      if (error instanceof IdempotencyKeyInUseError && idempotency) {
        if (await answerRepeatedOrder(response, repository, customerId, idempotency)) return;
        return response.status(409).json({
          title: "The Idempotency-Key is in use, try again",
          status: 409,
          code: "idempotency_key_in_progress",
        });
      }
      if (error instanceof InsufficientStockError)
        return response
          .status(409)
          .json({ title: "Not enough stock for this order", status: 409, code: "insufficient_stock" });
      if (error instanceof InventoryRequestError)
        return response
          .status(503)
          .json({ title: "Stock could not be checked, try again", status: 503, code: "stock_unavailable" });
      if (error instanceof CatalogUnavailableError)
        return response
          .status(503)
          .json({ title: "Catalog is unavailable, try again", status: 503, code: "catalog_unavailable" });
      if (error instanceof DeliveryOutOfRangeError)
        return response.status(422).json({
          title: error.message,
          status: 422,
          code: "delivery_out_of_range",
          distanceMeters: error.distanceMeters,
          maxDistanceMeters: error.maxDistanceMeters,
        });
      if (error instanceof PrescriptionProductError)
        return response.status(409).json(prescriptionProblem(error.productId));
      if (error instanceof UnpricedProductError)
        return response.status(409).json({
          title: error.message,
          status: 409,
          code: "product_unpriced",
          productId: error.productId,
        });
      return next(error);
    }
  });

  router.post("/orders/:id/transition", async (request, response, next) => {
    const orderStock = options.orderStock;
    if (!repository || !orderStock) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    const parsed = orderTransitionSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const current = await repository.getOrder(id.data.id);
      if (!current) return response.status(404).json({ title: "Order not found", status: 404 });
      const staff = isStaffActor(request);
      if (staff) {
        if (!actorMaySeeSite(request, current.selectedStoreId)) return siteAccessDenied(response);
      } else if (current.customerId !== actor(request)) {
        return response.status(404).json({ title: "Order not found", status: 404 });
      }
      // Staff run an order through its states. A shopper may only withdraw an order they have not paid for: any other
      // move would confirm or hand over an order without the money, and a hand over takes the stock off the shelf.
      if (
        !staff &&
        (parsed.data.status !== "Cancelled" || current.status !== "Pending" || current.paymentStatus !== "Pending")
      )
        return response.status(403).json({ title: "Staff action required", status: 403, code: "forbidden" });
      // Refuse an illegal move before anything touches the stock.
      assertOrderTransition(current.status as OrderStatus, parsed.data.status);
      const refusal = staff ? staffMoveRefusal(current, parsed.data.status) : undefined;
      if (refusal) return response.status(409).json({ title: refusal.title, status: 409, code: refusal.code });
      // The goods leave the shelf when the order is handed over: out for delivery, or collected at the store.
      if (parsed.data.status === "Delivering" || parsed.data.status === "Completed")
        await orderStock.consume(id.data.id);
      const transitioned = await repository.transitionOrder(id.data.id, parsed.data.status, actor(request));
      if (parsed.data.status === "Cancelled") await orderStock.releaseQuietly(id.data.id);
      return response.json(transitioned);
    } catch (error) {
      if (error instanceof InvalidOrderTransition)
        return response
          .status(409)
          .json({ title: "The order cannot move to that status", status: 409, code: "invalid_transition" });
      if (error instanceof InventoryRequestError)
        return response
          .status(502)
          .json({ title: "Stock could not be handed over, try again", status: 502, code: "stock_unavailable" });
      return next(error);
    }
  });

  router.get("/prescriptions", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const query = pagedListQuery.safeParse(request.query);
    const cursor = readCursorParam(request.query.cursor);
    if (!query.success) return invalid(response);
    if (!cursor.ok) return invalidCursor(response);
    try {
      const status = queryString(request.query.status);
      const { limit, q } = query.data;
      // The staff portal reviews the prescriptions of the caller's sites, optionally narrowed to one site or state, and
      // an internal reader such as the operations dashboard needs no actor of its own for that. A shopper only ever
      // sees the records linked to their own account, so the owner filter is never optional there.
      if (isStaffActor(request)) {
        return sendPage(
          response,
          await repository.listPrescriptions({ siteIds: listSiteIds(request), status, limit, q, after: cursor.cursor }),
        );
      }
      const requesterId = actor(request);
      if (!requesterId) return unauthorized(response);
      return sendPage(
        response,
        await repository.listPrescriptions({ customerId: requesterId, status, limit, q, after: cursor.cursor }),
      );
    } catch (error) {
      return next(error);
    }
  });

  // Registered before `/prescriptions/:id`, which would otherwise take `count` for an id. `status` and site scope are
  // the list's own filters; `excludeStatus` (comma-separated) drops the named states, e.g. `Dispensed,Cancelled` for
  // the open register. The count is a SQL COUNT(*), so it never depends on a page size.
  router.get("/prescriptions/count", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const requesterId = actor(request);
    if (!isStaffActor(request)) {
      if (!requesterId) return unauthorized(response);
      return response.status(403).json({ title: "Forbidden", status: 403, code: "forbidden" });
    }
    const excluded = excludeStatusParam.safeParse(queryString(request.query.excludeStatus));
    if (!excluded.success) return invalid(response);
    try {
      const count = await repository.countPrescriptions({
        siteIds: listSiteIds(request),
        status: queryString(request.query.status),
        excludeStatuses: excluded.data,
      });
      return response.json({ count });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/prescriptions/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    const requesterId = actor(request);
    if (!id.success) return invalid(response);
    if (!requesterId) return unauthorized(response);
    try {
      if (isStaffActor(request)) {
        const prescription = await repository.getPrescription(id.data.id);
        // A record at another site is not found to this staff member.
        if (!prescription || !actorMaySeeSite(request, prescription.siteId))
          return response.status(404).json({ title: "Prescription not found", status: 404 });
        return response.json(prescription);
      }
      const prescription = await repository.getPrescription(id.data.id);
      // A prescription carries the patient's name, phone, doctor and medicines, so a shopper asking for someone
      // else's record gets the same 404 as a missing one rather than a hint that it exists.
      if (!prescription || prescription.customerId !== requesterId) {
        return response.status(404).json({ title: "Prescription not found", status: 404 });
      }
      return response.json(prescription);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/prescriptions", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const createdBy = actor(request);
    const parsed = createPrescriptionRequestSchema.safeParse(request.body);
    if (!createdBy) return unauthorized(response);
    if (!parsed.success) return invalid(response);
    if (!actorMaySeeSite(request, parsed.data.siteId)) return siteAccessDenied(response);
    try {
      // A linked prescription belongs to a real customer account: a stale or invented id would file the record
      // against nobody, so the account is resolved before anything is written.
      if (parsed.data.customerId) {
        const customerCheck = await verifyCustomerAccount(parsed.data.customerId, options.identityServiceUrl);
        if (customerCheck === "missing") return invalidCustomer(response);
        if (customerCheck === "unavailable") return identityUnavailable(response);
      }
      const idempotencyKey = request.header("Idempotency-Key") ?? undefined;
      const prescription = await repository.createPrescription({
        siteId: parsed.data.siteId,
        storageLocationId: parsed.data.storageLocationId,
        patientName: parsed.data.patientName,
        patientPhone: parsed.data.patientPhone ?? null,
        doctorName: parsed.data.doctorName ?? null,
        doctorLicense: parsed.data.doctorLicense ?? null,
        notes: parsed.data.notes ?? null,
        customerId: parsed.data.customerId ?? null,
        createdBy,
        lines: parsed.data.lines.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          prescribedQuantity: line.prescribedQuantity,
          dosage: line.dosage ?? null,
          frequency: line.frequency ?? null,
          duration: line.duration ?? null,
          notes: line.notes ?? null,
        })),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      if ("idempotentReplay" in prescription && prescription.idempotentReplay === true)
        return response.status(201).json(prescription);
      if (!("id" in prescription) || typeof prescription.id !== "string")
        return next(new Error("Prescription insert did not return an id"));
      const inventoryResult = await reservePrescriptionStock(
        prescription.id,
        parsed.data.siteId,
        parsed.data.storageLocationId,
        parsed.data.lines.map((line) => ({ productId: line.productId, quantity: line.prescribedQuantity })),
        options.inventoryServiceUrl,
      );
      if (!inventoryResult.ok) {
        await repository.cancelPrescription(prescription.id, createdBy);
        // A fixed title the staff web can translate; the inventory wording stays in `detail`.
        return response.status(409).json({
          title: "Stock could not be reserved",
          status: 409,
          code: "stock_reservation_failed",
          detail: inventoryResult.reason,
        });
      }
      await repository.setPrescriptionReservation(prescription.id, prescription.id);
      return response.status(201).json(await repository.getPrescription(prescription.id));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/prescriptions/:id/cancel", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    const cancelledBy = actor(request);
    if (!id.success || !cancelledBy) return invalid(response);
    try {
      const prescription = await repository.getPrescription(id.data.id);
      if (!prescription) return response.status(404).json({ title: "Prescription not found", status: 404 });
      if (!actorMaySeeSite(request, prescription.siteId)) return siteAccessDenied(response);
      if (prescription.reservationId)
        await postInventoryRelease(prescription.reservationId, options.inventoryServiceUrl);
      return response.json(await repository.cancelPrescription(id.data.id, cancelledBy));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/prescriptions/:id/dispense", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    const parsed = dispensePrescriptionRequestSchema.safeParse(request.body);
    const dispensedBy = actor(request);
    if (!id.success || !parsed.success || !dispensedBy) return invalid(response);
    try {
      // The site is judged on the stored prescription before the locked dispense writes anything.
      const prescription = await repository.getPrescription(id.data.id);
      if (!prescription) return response.status(404).json({ title: "Prescription not found", status: 404 });
      if (!actorMaySeeSite(request, prescription.siteId)) return siteAccessDenied(response);
      const idempotencyKey = request.header("Idempotency-Key") ?? undefined;
      const dispensed = await repository.dispensePrescription(
        id.data.id,
        parsed.data.lines,
        dispensedBy,
        (dispense) => dispenseInventoryStock(dispense, dispensedBy, idempotencyKey, options.inventoryServiceUrl),
        idempotencyKey,
      );
      if (!dispensed) return response.status(404).json({ title: "Prescription not found", status: 404 });
      return response.json(dispensed);
    } catch (error) {
      // A fixed title the staff web can translate; the reason, ours or inventory's, stays in `detail`.
      if (error instanceof PrescriptionDispenseError || error instanceof InventoryDispenseError)
        return response.status(409).json({
          title: "Prescription could not be dispensed",
          status: 409,
          code: "dispense_rejected",
          detail: error.message,
        });
      return next(error);
    }
  });

  router.get("/counter-transactions", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!actor(request)) return unauthorized(response);
    // The day's takings behind the counter are a staff read; a shopper's receipts are the orders they placed.
    if (!isStaffActor(request))
      return response.status(403).json({ title: "Forbidden", status: 403, code: "forbidden" });
    const query = pagedListQuery.safeParse(request.query);
    const cursor = readCursorParam(request.query.cursor);
    if (!query.success) return invalid(response);
    if (!cursor.ok) return invalidCursor(response);
    try {
      const siteIds = listSiteIds(request);
      const status = queryString(request.query.paymentStatus);
      const filter: Parameters<SalesRepository["listCounterTransactions"]>[0] = {
        limit: query.data.limit,
        q: query.data.q,
        after: cursor.cursor,
      };
      if (siteIds) filter.siteIds = siteIds;
      if (status) filter.status = status;
      return sendPage(response, await repository.listCounterTransactions(filter));
    } catch (error) {
      return next(error);
    }
  });

  // Read by operations-query for the period analytics. trusted-request admits this path only with the service secret,
  // so the scope is the header the caller forwards: no `siteId` query narrows it, and no header leaves every site.
  router.get("/internal/analytics/sales-documents", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const period = salesDocumentsQuerySchema.safeParse({
      from: queryString(request.query.from),
      to: queryString(request.query.to),
    });
    if (!period.success) return invalid(response);
    try {
      const documents = await repository.listSalesDocuments({
        from: new Date(period.data.from),
        to: new Date(period.data.to),
        siteIds: actorSiteIds(request),
      });
      return response.json({ documents });
    } catch (error) {
      return next(error);
    }
  });

  // The first payment ever seen for the customers who bought in the period. The period and site scope choose the
  // customers; the payment date looks at their whole history, so a buyer from before the period counts as returning.
  router.get("/internal/analytics/customer-first-paid", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const period = salesDocumentsQuerySchema.safeParse({
      from: queryString(request.query.from),
      to: queryString(request.query.to),
    });
    if (!period.success) return invalid(response);
    try {
      const customers = await repository.listCustomerFirstPaid({
        from: new Date(period.data.from),
        to: new Date(period.data.to),
        siteIds: actorSiteIds(request),
      });
      return response.json({ customers });
    } catch (error) {
      return next(error);
    }
  });

  // A manager sets one site's revenue goal for a month; the edge and this service both allow only that role to write.
  router.put("/sales-targets", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = setSalesTargetSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    if (!actorMaySeeSite(request, parsed.data.siteId)) return siteAccessDenied(response);
    const actorId = actor(request);
    if (!actorId) return response.status(401).json({ title: "Authentication required", status: 401 });
    try {
      return response.json(await repository.setSalesTarget({ ...parsed.data, actorId }));
    } catch (error) {
      return next(error);
    }
  });

  // The targets of one month, for operations-query's revenue-against-target report.
  router.get("/internal/analytics/sales-targets", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const month = salesTargetMonthSchema.safeParse(queryString(request.query.month));
    if (!month.success) return invalid(response);
    try {
      const targets = await repository.listSalesTargets({
        month: month.data,
        siteIds: actorSiteIds(request),
      });
      return response.json({ targets });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

type CustomerCheck = "exists" | "missing" | "unavailable";

/**
 * The counter links a prescription to a customer account, so identity-service has to confirm the account exists
 * before the record is written. A 404 means the id is not a customer account; every other failure (a refused
 * connection, a timeout, a 5xx) fails closed, because writing first and checking later leaves an orphan record.
 */
const verifyCustomerAccount = async (customerId: string, baseUrl?: string): Promise<CustomerCheck> => {
  if (!baseUrl) return "unavailable";
  try {
    const response = await fetch(`${baseUrl}/internal/customers/${customerId}`, {
      headers: internalServiceHeaders(),
      signal: AbortSignal.timeout(2_000),
    });
    if (response.status === 404) return "missing";
    if (response.ok) return "exists";
    return "unavailable";
  } catch {
    return "unavailable";
  }
};

/**
 * Answers a repeat of an Idempotency-Key. The same request gets the order the key created, with the 201 of the first
 * answer and no catalog, stock or cart work. A different request under the same key gets 422 `idempotency_key_reuse`.
 * Returns false when the key is unknown, so the caller places the order.
 */
const answerRepeatedOrder = async (
  response: Response,
  repository: SalesRepository,
  customerId: string,
  idempotency: { key: string; requestHash: string },
): Promise<boolean> => {
  const existing = await repository.getOrderIdempotencyKey(customerId, idempotency.key);
  if (!existing) return false;
  if (existing.requestHash !== idempotency.requestHash)
    response.status(422).json({
      title: "Idempotency-Key was already used for a different order",
      status: 422,
      code: "idempotency_key_reuse",
    });
  else response.status(201).json(await repository.getOrder(existing.orderId));
  return true;
};

/** Catalog-service did not answer in time, could not be reached, or failed with a server error. */
class CatalogUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Catalog-service is unavailable", options);
    this.name = "CatalogUnavailableError";
  }
}

/** A catalog call that turns a timeout, a network failure or a 5xx answer into {@link CatalogUnavailableError}. */
const fetchCatalog = async (url: string): Promise<globalThis.Response> => {
  let response: globalThis.Response;
  try {
    response = await fetch(url, { headers: internalServiceHeaders(), signal: AbortSignal.timeout(2_000) });
  } catch (error) {
    throw new CatalogUnavailableError({ cause: error });
  }
  if (response.status >= 500) throw new CatalogUnavailableError();
  return response;
};

class UnpricedProductError extends Error {
  constructor(public readonly productId: string) {
    super("Product has no published price and cannot be ordered online");
    this.name = "UnpricedProductError";
  }
}

/** A prescription-only product cannot be ordered online or kept in the cart (BR-ORD-011). */
class PrescriptionProductError extends Error {
  constructor(public readonly productId: string) {
    super("Prescription-only products cannot be ordered online");
    this.name = "PrescriptionProductError";
  }
}

const prescriptionProblem = (productId: string) => ({
  title: "Prescription-only products cannot be ordered online",
  detail: "Thuốc kê đơn không đặt online. Hãy gửi đơn thuốc hoặc nhờ dược sĩ tư vấn.",
  status: 409,
  code: "prescription_required",
  productId,
});

/**
 * The ids among `productIds` that catalog marks prescription-only. A product catalog does not know (404) is not
 * flagged, so a stale line cannot block a merge; any other catalog failure throws rather than let one through.
 */
const findPrescriptionProductIds = async (productIds: string[], baseUrl: string): Promise<Set<string>> => {
  const flagged = new Set<string>();
  await Promise.all(
    [...new Set(productIds)].map(async (productId) => {
      const response = await fetchCatalog(`${baseUrl}/products/${productId}`);
      if (response.status === 404) return;
      if (!response.ok) throw new Error("Product is unavailable");
      const product = (await response.json()) as { prescriptionRequired?: boolean };
      if (product.prescriptionRequired === true) flagged.add(productId);
    }),
  );
  return flagged;
};

const resolveOrderLines = async (
  lines: Array<{ productId: string; productUnitId: string; quantity: number }>,
  baseUrl: string,
): Promise<
  Array<{
    productId: string;
    productUnitId: string;
    productNameSnapshot: string;
    unitPriceSnapshot: number;
    quantity: number;
  }>
> => {
  return Promise.all(
    lines.map(async (line) => {
      const [productResponse, priceResponse] = await Promise.all([
        fetchCatalog(`${baseUrl}/products/${line.productId}`),
        fetchCatalog(
          `${baseUrl}/pricing/active?productId=${line.productId}&productUnitId=${line.productUnitId}&effectiveDate=${new Date().toISOString().slice(0, 10)}`,
        ),
      ]);
      if (!productResponse.ok) throw new Error("Product or active price is unavailable");
      const product = (await productResponse.json()) as { id: string; name: string; prescriptionRequired?: boolean };
      if (product.prescriptionRequired === true) throw new PrescriptionProductError(line.productId);
      if (priceResponse.status === 404) throw new UnpricedProductError(line.productId);
      if (!priceResponse.ok) throw new Error("Product or active price is unavailable");
      const price = (await priceResponse.json()) as {
        productId: string;
        productUnitId: string;
        unitPrice: string | number;
        currency: string;
      };
      if (price.productId !== line.productId || price.productUnitId !== line.productUnitId || price.currency !== "VND")
        throw new Error("Catalog price validation failed");
      return {
        productId: line.productId,
        productUnitId: line.productUnitId,
        productNameSnapshot: product.name,
        unitPriceSnapshot: Number(price.unitPrice),
        quantity: line.quantity,
      };
    }),
  );
};

const reservePrescriptionStock = async (
  reservationId: string,
  siteId: string,
  storageLocationId: string,
  lines: Array<{ productId: string; quantity: number }>,
  baseUrl: string,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const response = await fetch(`${baseUrl}/inventory/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json", ...internalServiceHeaders() },
    body: JSON.stringify({ reservationId, sourceSiteId: siteId, sourceLocationId: storageLocationId, lines }),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.ok) return { ok: true };
  const body = await response.text();
  return { ok: false, reason: body || "Inventory reservation failed" };
};

const postInventoryRelease = async (reservationId: string, baseUrl: string): Promise<void> => {
  const response = await fetch(`${baseUrl}/inventory/reservations/${reservationId}/release`, {
    method: "POST",
    headers: internalServiceHeaders(),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Inventory reservation release failed");
};

/** Inventory refused the goods: wrong batch, not releasable, or not on the shelf. */
class InventoryDispenseError extends Error {}

/** The reason in inventory's refusal, shown to the pharmacist. */
const inventoryProblemSchema = z.object({ detail: z.string() });

/**
 * Takes the dispensed goods off inventory's shelf. A retried request carries the same Idempotency-Key, so inventory
 * answers it again without moving the stock twice; without a key, the locked prescription is what stops a repeat.
 */
const dispenseInventoryStock = async (
  dispense: PrescriptionStockDispense,
  actorId: string,
  idempotencyKey: string | undefined,
  baseUrl: string,
): Promise<void> => {
  const response = await fetch(`${baseUrl}/inventory/dispenses`, {
    method: "POST",
    headers: { ...internalServiceHeaders(actorId), "Content-Type": "application/json" },
    body: JSON.stringify({
      // Hashed so a long client key still fits inventory's 128-character idempotency key.
      dispenseId: createHash("sha256")
        .update(`${dispense.prescriptionId}:${idempotencyKey ?? randomUUID()}`)
        .digest("hex"),
      ...(dispense.reservationId ? { reservationId: dispense.reservationId } : {}),
      prescriptionId: dispense.prescriptionId,
      siteId: dispense.siteId,
      storageLocationId: dispense.storageLocationId,
      lines: dispense.lines,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.ok) return;
  if (response.status === 409) {
    const problem = inventoryProblemSchema.safeParse(await response.json().catch(() => undefined));
    throw new InventoryDispenseError(problem.success ? problem.data.detail : "Stock could not be dispensed");
  }
  throw new Error(`Inventory dispense failed with status ${response.status}`);
};

const toDeliverySnapshot = (delivery: DeliveryCalculation) => ({
  selectedStoreId: delivery.selectedStoreId,
  originLatitude: String(delivery.origin.latitude),
  originLongitude: String(delivery.origin.longitude),
  destinationLatitude: String(delivery.destination.latitude),
  destinationLongitude: String(delivery.destination.longitude),
  providerResolvedAddress: delivery.providerResolvedAddress,
  addressNote: delivery.addressNote,
  distanceMeters: String(delivery.distanceMeters),
  durationSeconds: String(delivery.durationSeconds),
  routeGeoJson: JSON.stringify(delivery.route),
});

const roundMoney = (value: number): number => Math.round(value * 100) / 100;
const queryString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const unauthorized = (response: Response) =>
  response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
const invalid = (response: Response) =>
  response.status(400).json({ title: "Invalid sales request", status: 400, code: "invalid_request" });
const invalidCustomer = (response: Response) =>
  response.status(400).json({ title: "Customer account not found", status: 400, code: "invalid_customer" });
const identityUnavailable = (response: Response) =>
  response.status(503).json({
    title: "Identity service is unavailable",
    status: 503,
    code: "identity_unavailable",
    detail: "Không lấy được thông tin khách hàng, vui lòng thử lại.",
  });
