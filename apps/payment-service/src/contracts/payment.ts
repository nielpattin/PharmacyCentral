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

/** Largest page `GET /payments/invoices` answers; a larger `limit` is clamped to it. */
export const invoiceListMaxLimit = 500;

/**
 * Query of `GET /payments/invoices`. With no `limit` and no `cursor` the answer is the whole list, as before. A `limit`
 * (default 100 when only a `cursor` is sent) answers one page and `X-Next-Cursor` names the next one.
 * `status` matches the stored invoice status exactly. `q` is a case-insensitive substring over the invoice number
 * (`paymentCode`), the `orderId` and the `customerId`, as stored.
 */
export const invoiceListQuerySchema = z.object({
  status: z.enum(["Pending", "Paid", "Failed", "Refunded", "Cancelled"]).optional(),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .transform((value) => Math.min(value, invoiceListMaxLimit))
    .optional(),
  cursor: z.string().min(1).max(512).optional(),
});

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
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
