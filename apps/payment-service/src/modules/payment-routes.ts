import { randomUUID } from "node:crypto";

import { Router, type Response } from "express";
import { z } from "zod";

import { createInvoiceRequestSchema, invoiceListQuerySchema, paidInvoicesQuerySchema } from "../contracts/payment.ts";
import { internalServiceHeaders } from "../internal-service-headers.ts";
import { actorSiteIds } from "../middleware/trusted-request.ts";

import {
  actorRoles,
  cashConfirmationRefusal,
  counterInvoiceRefusal,
  forwardedActorHeaders,
  refundRefusal,
  siteScopeRefusal,
} from "./payment-access.ts";
import { InvoiceRefusal, priceInvoiceRequest, type PayableOrder } from "./invoice-pricing.ts";
import { decodePageCursor, encodePageCursor } from "./page-cursor.ts";
import { PaymentRepository } from "./payment-repository.ts";

const idSchema = z.object({ id: z.string().uuid() });
const actor = (request: import("express").Request): string | undefined => request.header("X-Actor-Id") ?? undefined;
const employee = (request: import("express").Request): boolean => request.header("X-Actor-Type") === "employee";

export type PaymentRouterOptions = {
  /** Both URLs are validated at boot by main.ts, so a missing one is a type error and never a localhost guess. */
  salesServiceUrl: string;
  catalogServiceUrl: string;
};

/** The most paid invoices one analytics read answers. A range with more is refused with 422, never cut short. */
export const PAID_INVOICES_ANALYTICS_CAP = 50_000;

export const createPaymentRouter = (
  repository: PaymentRepository | undefined,
  options: PaymentRouterOptions,
): Router => {
  const router = Router();

  router.post("/payments/prescriptions/:prescriptionId", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const prescriptionId = z.string().uuid().safeParse(request.params.prescriptionId);
    const createdBy = actor(request);
    if (!prescriptionId.success || !createdBy) return unauthorized(response);
    const roleRefusal = counterInvoiceRefusal(actorRoles(request));
    if (roleRefusal) return response.status(roleRefusal.status).json(roleRefusal);
    try {
      const salesResponse = await fetch(`${options.salesServiceUrl}/prescriptions/${prescriptionId.data}`, {
        headers: { ...internalServiceHeaders(createdBy), ...forwardedActorHeaders(request) },
        signal: AbortSignal.timeout(2_000),
      });
      if (!salesResponse.ok)
        return response
          .status(salesResponse.status === 404 ? 404 : 502)
          .json({ title: "Prescription could not be loaded", status: salesResponse.status === 404 ? 404 : 502 });
      const prescription = (await salesResponse.json()) as {
        siteId: string;
        lines: Array<{ productId: string; productUnitId: string; prescribedQuantity: string }>;
      };
      // The site is judged before the invoice is read or written, so a refused caller learns nothing about the invoice.
      const siteRefusal = siteScopeRefusal(prescription.siteId, actorSiteIds(request));
      if (siteRefusal) return response.status(siteRefusal.status).json(siteRefusal);
      const existing = await repository.getInvoiceByPrescription(prescriptionId.data);
      if (existing) return response.json(existing);
      const lines = await Promise.all(
        prescription.lines.map(async (line) => {
          const [productResponse, priceResponse] = await Promise.all([
            fetch(`${options.catalogServiceUrl}/products/${line.productId}`, {
              headers: internalServiceHeaders(),
              signal: AbortSignal.timeout(2_000),
            }),
            fetch(
              `${options.catalogServiceUrl}/pricing/active?productId=${line.productId}&productUnitId=${line.productUnitId}&siteId=${prescription.siteId}&effectiveDate=${new Date().toISOString().slice(0, 10)}`,
              { headers: internalServiceHeaders(), signal: AbortSignal.timeout(2_000) },
            ),
          ]);
          if (!productResponse.ok || !priceResponse.ok) throw new Error("Prescription catalog price is unavailable");
          const product = (await productResponse.json()) as { name: string };
          const price = (await priceResponse.json()) as { unitPrice: string; currency: string };
          return {
            productId: line.productId,
            productUnitId: line.productUnitId,
            description: product.name,
            quantity: Number(line.prescribedQuantity),
            unitPrice: Number(price.unitPrice),
            currency: price.currency,
          };
        }),
      );
      return response.status(201).json(
        await repository.createInvoice({
          invoiceId: randomUUID(),
          prescriptionId: prescriptionId.data,
          customerId: createdBy,
          paymentMethod: "sepay_qr",
          lines,
        }),
      );
    } catch (error) {
      return next(error);
    }
  });

  router.post("/payments/invoices", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = createInvoiceRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response);
    try {
      const isEmployee = employee(request);
      if (!isEmployee) {
        // A retry of the request that already made this shopper's invoice gets the same invoice back, even after
        // the order has been paid and no longer waits for payment.
        const existing = await repository.getInvoice(parsed.data.invoiceId);
        if (existing)
          return existing.customerId === actor(request) && existing.orderId === (parsed.data.orderId ?? null)
            ? response.status(201).json(existing)
            : response.status(404).json({ title: "Order not found", status: 404, code: "order_not_found" });
      }
      const priced = await priceInvoiceRequest({
        body: parsed.data,
        actorId: actor(request),
        isEmployee,
        loadOrder: (orderId, actorId) => loadOrderOf(options.salesServiceUrl, orderId, actorId),
      });
      const invoice = await repository.createInvoice({
        ...priced,
        ...(actor(request) ? { customerId: actor(request) } : {}),
      });
      return response.status(201).json(invoice);
    } catch (error) {
      if (error instanceof InvoiceRefusal)
        return response.status(error.status).json({ title: error.message, status: error.status, code: error.code });
      return next(error);
    }
  });

  router.get("/payments/invoices", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = invoiceListQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(response);
    const { status, q, limit, cursor: rawCursor } = parsed.data;
    const cursor = rawCursor === undefined ? undefined : decodePageCursor(rawCursor);
    if (rawCursor !== undefined && cursor === undefined) return invalidCursor(response);
    // A cursor with no limit still pages, at the default size; no parameter at all keeps the whole-list answer.
    const pageSize = limit ?? (rawCursor === undefined ? undefined : 100);
    const customerId = employee(request) ? undefined : actor(request);
    try {
      const page = await repository.listInvoices({ customerId, status, q, limit: pageSize, cursor });
      // The body stays a plain array; the cursor of the next page travels in a header.
      if (page.next) response.set("X-Next-Cursor", encodePageCursor(page.next));
      return response.json(page.rows);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/payments/invoices/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const invoice = await repository.getInvoice(id.data.id);
      if (!invoice || !canReadInvoice(request, invoice.customerId))
        return response.status(404).json({ title: "Invoice not found", status: 404 });
      return response.json(invoice);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/payments/invoices/:id/invoice", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const invoice = await repository.getInvoice(id.data.id);
      if (!invoice || !canReadInvoice(request, invoice.customerId))
        return response.status(404).json({ title: "Invoice not found", status: 404 });
      return response.json(await repository.printableInvoice(id.data.id));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/payments/:id", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const invoice = await repository.getInvoice(id.data.id);
      if (!invoice || !canReadInvoice(request, invoice.customerId))
        return response.status(404).json({ title: "Invoice not found", status: 404 });
      return response.json(invoice);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/payments/:id/invoice", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const invoice = await repository.getInvoice(id.data.id);
      if (!invoice || !canReadInvoice(request, invoice.customerId))
        return response.status(404).json({ title: "Invoice not found", status: 404 });
      return response.json(await repository.printableInvoice(id.data.id));
    } catch (error) {
      return next(error);
    }
  });

  router.post("/payments/:id/confirm-counter", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    const refusal = cashConfirmationRefusal(actorRoles(request));
    if (refusal) return response.status(refusal.status).json(refusal);
    try {
      const invoice = await repository.markCashPaid(id.data.id, actor(request));
      return invoice ? response.json(invoice) : response.status(404).json({ title: "Invoice not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/payments/:id/refund", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    const parsed = z.object({ reason: z.string().trim().min(1).max(500) }).safeParse(request.body);
    if (!id.success || !parsed.success) return invalid(response);
    try {
      const existing = await repository.getInvoice(id.data.id);
      if (!existing) return response.status(404).json({ title: "Invoice not found", status: 404 });
      // The invoice kind decides the role, so the refusal is judged before the refund writes anything.
      const refusal = refundRefusal(existing, actorRoles(request));
      if (refusal) return response.status(refusal.status).json(refusal);
      const invoice = await repository.refund(id.data.id, parsed.data.reason, actor(request));
      return invoice ? response.json(invoice) : response.status(404).json({ title: "Invoice not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/payments/:id/reconciliation", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const invoice = await repository.getInvoice(id.data.id);
      if (!invoice) return response.status(404).json({ title: "Invoice not found", status: 404 });
      return response.json(invoice.reconciliation ?? { paymentInvoiceId: id.data.id, state: "Open" });
    } catch (error) {
      return next(error);
    }
  });

  // Read by operations-query for the period analytics. trusted-request admits this path only with the service secret.
  router.get("/internal/analytics/paid-invoices", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const parsed = paidInvoicesQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(response);
    try {
      const rows = await repository.listPaidInvoicesSince(new Date(parsed.data.since), PAID_INVOICES_ANALYTICS_CAP + 1);
      if (rows.length > PAID_INVOICES_ANALYTICS_CAP)
        return response.status(422).json({
          title: "Analytics range is too large",
          status: 422,
          code: "analytics_range_too_large",
        });
      return response.json({
        invoices: rows.map((row) => ({
          orderId: row.orderId,
          prescriptionId: row.prescriptionId,
          amount: Number(row.amount),
          createdAt: row.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

export const applyWebhook = async (
  repository: PaymentRepository | undefined,
  payload: unknown,
): Promise<SePayWebhookResult> => {
  if (!repository) return undefined;
  const transaction = readSePayTransaction(payload);
  if (transaction === undefined) return undefined;
  if (transaction === "outbound_transfer") return { accepted: false, reason: "outbound_transfer" };
  return repository.applyProviderTransaction({ provider: "sepay", ...transaction });
};

export type SePayTransaction = {
  paymentCodes: string[];
  providerTransactionId: string;
  amount: number;
  metadata: Record<string, unknown>;
};

/** Returns `undefined` for a payload that cannot be applied at all (not an object, no code, id, or positive amount). */
export const readSePayTransaction = (payload: unknown): SePayTransaction | "outbound_transfer" | undefined => {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = payload as Record<string, unknown>;
  const transferType = typeof value.transferType === "string" ? value.transferType.toLowerCase() : "in";
  if (transferType !== "in") return "outbound_transfer";
  const paymentCodes = extractPaymentCodes(value);
  const rawTransactionId = value.id ?? value.transactionId;
  const providerTransactionId =
    typeof rawTransactionId === "string" || typeof rawTransactionId === "number" ? String(rawTransactionId) : "";
  const amount = Number(value.transferAmount ?? value.amount ?? 0);
  if (paymentCodes.length === 0 || !providerTransactionId || !Number.isFinite(amount) || amount <= 0) return undefined;
  return {
    paymentCodes,
    providerTransactionId,
    amount,
    metadata: { gateway: value.gateway, description: value.description, accountNumber: value.accountNumber },
  };
};

export type SePayWebhookOutcome = "accepted" | "duplicate" | "invalid_payload" | "unmatched";

/** `undefined` when no invoice was matched or the payload was unusable; the repository reports the rest. */
export type SePayWebhookResult =
  | { accepted: false; reason: "outbound_transfer" }
  | { invoiceId: string; duplicate: boolean; status: string; reason: string }
  | undefined;

/** Classifies the result of `applyWebhook` for a payload that was already handled; `result` is never a thrown error. */
export const sePayWebhookOutcome = (result: SePayWebhookResult, payload: unknown): SePayWebhookOutcome => {
  if (result === undefined) return readSePayTransaction(payload) === undefined ? "invalid_payload" : "unmatched";
  if ("accepted" in result) return "unmatched";
  return result.duplicate ? "duplicate" : "accepted";
};

// Our payment codes are `PC-` plus 16 hex characters. Banks may drop the hyphen and may append further
// characters to the memo, and SePay's own code detection never matches across the hyphen, so scan every field
// SePay populates for a `PC` followed by 16 hex characters and let the repository resolve the first code it knows.
const paymentCodePattern = /PC-?([0-9A-F]{16})/g;
const extractPaymentCodes = (value: Record<string, unknown>): string[] => {
  const codes: string[] = [];
  for (const candidate of [value.code, value.content, value.description]) {
    if (typeof candidate !== "string") continue;
    for (const match of candidate.toUpperCase().matchAll(paymentCodePattern)) {
      const suffix = match[1];
      if (!suffix) continue;
      const code = `PC-${suffix}`;
      if (!codes.includes(code)) codes.push(code);
    }
  }
  return codes;
};

/** Reads an order from sales-service as the shopper; sales answers 404 for an order that belongs to someone else. */
const loadOrderOf = async (
  salesServiceUrl: string,
  orderId: string,
  actorId: string,
): Promise<PayableOrder | undefined> => {
  const upstream = await fetch(`${salesServiceUrl}/orders/${orderId}`, {
    headers: internalServiceHeaders(actorId),
    signal: AbortSignal.timeout(2_000),
  });
  if (upstream.status === 404) return undefined;
  if (!upstream.ok) throw new Error(`Sales-service answered ${upstream.status} for the order of an invoice`);
  return (await upstream.json()) as PayableOrder;
};

const canReadInvoice = (request: import("express").Request, customerId: string | null): boolean =>
  employee(request) || !actor(request) || customerId === actor(request);
const unavailable = (response: import("express").Response) =>
  response.status(503).json({ title: "Payment database is not configured", status: 503 });
const unauthorized = (response: import("express").Response) =>
  response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
const invalid = (response: import("express").Response) =>
  response.status(400).json({ title: "Invalid payment request", status: 400, code: "invalid_request" });
const invalidCursor = (response: Response) =>
  response.status(400).json({ title: "Invalid page cursor", status: 400, code: "invalid_cursor" });
