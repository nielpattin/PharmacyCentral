import { z } from "zod";

export const paymentContractVersion = "v1" as const;

export const paymentChangedEventSchema = z.object({
  invoiceId: z.string().uuid(),
  status: z.enum(["pending", "paid", "failed", "refunded", "cancelled"]),
  provider: z.string().min(1),
});

export const invoiceLineSchema = z.object({
  productId: z.string().uuid(),
  productUnitId: z.string().uuid(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive(),
  unitPrice: z.number().positive(),
  currency: z.string().length(3),
});

export const createInvoiceRequestSchema = z.object({
  invoiceId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  prescriptionId: z.string().uuid().optional(),
  lines: z.array(invoiceLineSchema).min(1),
  paymentMethod: z.enum(["sepay_qr", "cash_on_delivery", "cash"]),
});

export const paymentStatusSchema = z.enum(["pending", "paid", "failed", "refunded", "cancelled"]);

export const paymentStatusResponseSchema = z.object({
  invoiceId: z.string().uuid(),
  status: paymentStatusSchema,
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
});

export type PaymentChangedEvent = z.infer<typeof paymentChangedEventSchema>;
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;
export type CreateInvoiceRequest = z.infer<typeof createInvoiceRequestSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type PaymentStatusResponse = z.infer<typeof paymentStatusResponseSchema>;
