import { randomUUID } from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import { createInvoiceRequestSchema } from "../contracts/payment.ts";
import { internalServiceHeaders } from "../internal-service-headers.ts";

import { PaymentRepository } from "./payment-repository.ts";

const idSchema = z.object({ id: z.string().uuid() });
const actor = (request: import("express").Request): string | undefined => request.header("X-Actor-Id") ?? undefined;
const employee = (request: import("express").Request): boolean => request.header("X-Actor-Type") === "employee";

export const createPaymentRouter = (repository: PaymentRepository | undefined): Router => {
  const router = Router();

  router.post("/payments/prescriptions/:prescriptionId", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const prescriptionId = z.string().uuid().safeParse(request.params.prescriptionId);
    const createdBy = actor(request);
    if (!prescriptionId.success || !createdBy) return unauthorized(response);
    try {
      const existing = await repository.getInvoiceByPrescription(prescriptionId.data);
      if (existing) return response.json(existing);
      const salesUrl = process.env.SALES_SERVICE_URL ?? "http://localhost:3005";
      const salesResponse = await fetch(`${salesUrl}/prescriptions/${prescriptionId.data}`, {
        headers: internalServiceHeaders(createdBy),
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
      const catalogUrl = process.env.CATALOG_SERVICE_URL ?? "http://localhost:3002";
      const lines = await Promise.all(
        prescription.lines.map(async (line) => {
          const [productResponse, priceResponse] = await Promise.all([
            fetch(`${catalogUrl}/products/${line.productId}`, {
              headers: internalServiceHeaders(),
              signal: AbortSignal.timeout(2_000),
            }),
            fetch(
              `${catalogUrl}/pricing/active?productId=${line.productId}&productUnitId=${line.productUnitId}&siteId=${prescription.siteId}&effectiveDate=${new Date().toISOString().slice(0, 10)}`,
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
      const invoice = await repository.createInvoice({
        ...parsed.data,
        ...(actor(request) ? { customerId: actor(request) } : {}),
      });
      return response.status(201).json(invoice);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/payments/invoices", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const customerId = employee(request) ? undefined : actor(request);
    try {
      return response.json(await repository.listInvoices(customerId));
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

  router.post("/payments/:id/cash-paid", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
    try {
      const invoice = await repository.markCashPaid(id.data.id, actor(request));
      return invoice ? response.json(invoice) : response.status(404).json({ title: "Invoice not found", status: 404 });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/payments/:id/confirm-counter", async (request, response, next) => {
    if (!repository) return unavailable(response);
    const id = idSchema.safeParse(request.params);
    if (!id.success) return invalid(response);
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

  return router;
};

export const applyWebhook = async (repository: PaymentRepository | undefined, payload: unknown) => {
  if (!repository || typeof payload !== "object" || payload === null) return undefined;
  const value = payload as Record<string, unknown>;
  const transferType = typeof value.transferType === "string" ? value.transferType.toLowerCase() : "in";
  if (transferType !== "in") return { accepted: false, reason: "outbound_transfer" };
  const paymentCode = extractPaymentCode(value);
  const rawTransactionId = value.id ?? value.transactionId;
  const providerTransactionId =
    typeof rawTransactionId === "string" || typeof rawTransactionId === "number" ? String(rawTransactionId) : "";
  const amount = Number(value.transferAmount ?? value.amount ?? 0);
  if (!paymentCode || !providerTransactionId || !Number.isFinite(amount) || amount <= 0) return undefined;
  return repository.applyProviderTransaction({
    paymentCode,
    provider: "sepay",
    providerTransactionId,
    amount,
    metadata: { gateway: value.gateway, description: value.description, accountNumber: value.accountNumber },
  });
};

const extractPaymentCode = (value: Record<string, unknown>): string | undefined => {
  const candidates = [value.code, value.content, value.description];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const match = candidate.toUpperCase().match(/PC-[A-Z0-9]+/);
    if (match) return match[0];
  }
  return undefined;
};

const canReadInvoice = (request: import("express").Request, customerId: string | null): boolean =>
  employee(request) || !actor(request) || customerId === actor(request);
const unavailable = (response: import("express").Response) =>
  response.status(503).json({ title: "Payment database is not configured", status: 503 });
const unauthorized = (response: import("express").Response) =>
  response.status(401).json({ title: "Authentication required", status: 401, code: "unauthenticated" });
const invalid = (response: import("express").Response) =>
  response.status(400).json({ title: "Invalid payment request", status: 400, code: "invalid_request" });
