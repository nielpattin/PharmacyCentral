import { randomBytes } from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import {
  cartLineSchema,
  createOrderRequestSchema,
  createPrescriptionRequestSchema,
  dispensePrescriptionRequestSchema,
  orderTransitionSchema,
} from "../contracts/sales.ts";
import { internalServiceHeaders } from "../internal-service-headers.ts";

import type { DeliveryCalculation, DeliveryCalculator } from "./delivery/domain/delivery-calculator.ts";
import { SalesRepository } from "./sales-repository.ts";

const idSchema = z.object({ id: z.string().uuid() });
const actor = (request: import("express").Request): string | undefined => request.header("X-Actor-Id") ?? undefined;
const guestToken = (request: import("express").Request): string | undefined =>
  request.header("X-Guest-Cart-Token") ?? request.headers.cookie?.match(/(?:^|;\s*)pharmacy_guest_cart=([^;]+)/)?.[1];

export type SalesRouterOptions = {
  catalogServiceUrl?: string | undefined;
  inventoryServiceUrl?: string | undefined;
  deliveryCalculator?: DeliveryCalculator | undefined;
  lookupStore?: (storeId: string) => Promise<{ id: string; latitude: number; longitude: number } | undefined>;
};

export const createSalesRouter = (
  repository: SalesRepository | undefined,
  options: SalesRouterOptions = {},
): Router => {
  const router = Router();

  router.get("/carts", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    const token = guestToken(request) ?? (customerId ? undefined : randomBytes(24).toString("base64url"));
    if (!customerId && token && !guestToken(request)) setGuestCookie(response, token);
    try {
      return response.json(await repository.getOrCreateCart(customerId, token));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/carts/lines", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = cartLineSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    const customerId = actor(request);
    const token = guestToken(request) ?? (customerId ? undefined : randomBytes(24).toString("base64url"));
    if (!customerId && token && !guestToken(request)) setGuestCookie(response, token);
    try {
      return response.status(201).json(await repository.addCartLine(customerId, token, parsed.data));
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/carts", async (request, response, next) => {
    if (!repository) return unavailable(response);
    try {
      return response.json(await repository.clearCart(actor(request), guestToken(request)));
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/carts/lines/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    const parsed = z.object({ quantity: z.number().nonnegative() }).safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const cart = await repository.updateCartLine(
        actor(request),
        guestToken(request),
        id.data.id,
        parsed.data.quantity,
      );
      return cart ? response.json(cart) : response.status(404).json({ title: "Cart not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/carts/merge", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    const token = guestToken(request);
    if (!customerId || !token)
      return response.status(400).json({ title: "Customer and guest cart token are required", status: 400 });
    try {
      return response.json(await repository.mergeGuestCart(customerId, token));
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
    const customerId = actor(request);
    if (!customerId) return unauthorized(response);
    try {
      return response.json(
        await repository.listOrders(
          customerId,
          typeof request.query.status === "string" ? request.query.status : undefined,
        ),
      );
    } catch (error) {
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
      if (!order || order.customerId !== customerId)
        return response.status(404).json({ title: "Order not found", status: 404 });
      return response.json(order);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/orders", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = actor(request);
    const parsed = createOrderRequestSchema.safeParse(request.body);
    if (!customerId) return unauthorized(response);
    if (!parsed.success) return invalid(response);
    try {
      const lines = await resolveOrderLines(parsed.data.lines, parsed.data.selectedStoreId, options.catalogServiceUrl);
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
        lines,
        ...(delivery ? { delivery: toDeliverySnapshot(delivery) } : {}),
      });
      return response.status(201).json(await repository.getOrder(order.id));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/orders/:id/transition", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    const parsed = orderTransitionSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const current = await repository.getOrder(id.data.id);
      if (!current) return response.status(404).json({ title: "Order not found", status: 404 });
      const customerId = actor(request);
      if (customerId && current.customerId !== customerId)
        return response.status(404).json({ title: "Order not found", status: 404 });
      return response.json(await repository.transitionOrder(id.data.id, parsed.data.status));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/prescriptions", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!actor(request)) return unauthorized(response);
    try {
      const siteId = queryString(request.query.siteId);
      const status = queryString(request.query.status);
      const filter: { limit: number; siteId?: string; status?: string } = {
        limit: queryNumber(request.query.limit, 100),
      };
      if (siteId) filter.siteId = siteId;
      if (status) filter.status = status;
      return response.json(await repository.listPrescriptions(filter));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/prescriptions/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success || !actor(request)) return invalid(response);
    try {
      const prescription = await repository.getPrescription(id.data.id);
      return prescription
        ? response.json(prescription)
        : response.status(404).json({ title: "Prescription not found", status: 404 });
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
    try {
      const idempotencyKey = request.header("Idempotency-Key") ?? undefined;
      const prescription = await repository.createPrescription({
        siteId: parsed.data.siteId,
        storageLocationId: parsed.data.storageLocationId,
        patientName: parsed.data.patientName,
        patientPhone: parsed.data.patientPhone ?? null,
        doctorName: parsed.data.doctorName ?? null,
        doctorLicense: parsed.data.doctorLicense ?? null,
        notes: parsed.data.notes ?? null,
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
        return response
          .status(409)
          .json({ title: inventoryResult.reason, status: 409, code: "stock_reservation_failed" });
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
      if (prescription.reservationId)
        await postInventoryAction(prescription.reservationId, "release", options.inventoryServiceUrl);
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
      const idempotencyKey = request.header("Idempotency-Key") ?? undefined;
      if (idempotencyKey) {
        const replay = await repository.getIdempotencyResponse(
          idempotencyKey,
          "sales.prescriptions.dispense",
          dispensedBy,
        );
        if (replay) return response.json(replay);
      }
      const prescription = await repository.getPrescription(id.data.id);
      if (!prescription) return response.status(404).json({ title: "Prescription not found", status: 404 });
      if (prescription.reservationId)
        await postInventoryAction(prescription.reservationId, "consume", options.inventoryServiceUrl);
      return response.json(
        await repository.dispensePrescription(id.data.id, parsed.data.lines, dispensedBy, idempotencyKey),
      );
    } catch (error) {
      return next(error);
    }
  });

  router.get("/counter-transactions", async (request, response, next) => {
    if (!repository) return unavailable(response);
    if (!actor(request)) return unauthorized(response);
    try {
      const siteId = queryString(request.query.siteId);
      const status = queryString(request.query.paymentStatus);
      const filter: { limit: number; siteId?: string; status?: string } = {
        limit: queryNumber(request.query.limit, 100),
      };
      if (siteId) filter.siteId = siteId;
      if (status) filter.status = status;
      return response.json(await repository.listCounterTransactions(filter));
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

const resolveOrderLines = async (
  lines: Array<{ productId: string; productUnitId: string; quantity: number }>,
  siteId: string,
  baseUrl = process.env.CATALOG_SERVICE_URL ?? "http://localhost:3002",
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
        fetch(`${baseUrl}/products/${line.productId}`, {
          headers: internalServiceHeaders(),
          signal: AbortSignal.timeout(2_000),
        }),
        fetch(
          `${baseUrl}/pricing/active?productId=${line.productId}&productUnitId=${line.productUnitId}&siteId=${siteId}&effectiveDate=${new Date().toISOString().slice(0, 10)}`,
          { headers: internalServiceHeaders(), signal: AbortSignal.timeout(2_000) },
        ),
      ]);
      if (!productResponse.ok || !priceResponse.ok) throw new Error("Product or active price is unavailable");
      const product = (await productResponse.json()) as { id: string; name: string };
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
  baseUrl = process.env.INVENTORY_SERVICE_URL ?? "http://localhost:3004",
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

const postInventoryAction = async (
  reservationId: string,
  action: "release" | "consume",
  baseUrl = process.env.INVENTORY_SERVICE_URL ?? "http://localhost:3004",
): Promise<void> => {
  const response = await fetch(`${baseUrl}/inventory/reservations/${reservationId}/${action}`, {
    method: "POST",
    headers: internalServiceHeaders(),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Inventory reservation ${action} failed`);
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
const queryNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const setGuestCookie = (response: import("express").Response, token: string): void => {
  response.setHeader("Set-Cookie", `pharmacy_guest_cart=${token}; SameSite=Lax; Path=/; Max-Age=2592000`);
};
const unavailable = (response: import("express").Response) =>
  response.status(503).json({ title: "Sales database is not configured", status: 503 });
const unauthorized = (response: import("express").Response) =>
  response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
const invalid = (response: import("express").Response) =>
  response.status(400).json({ title: "Invalid sales request", status: 400, code: "invalid_request" });
