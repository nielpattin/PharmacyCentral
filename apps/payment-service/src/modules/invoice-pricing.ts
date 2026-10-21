import type { CreateInvoiceRequest } from "../contracts/payment.ts";

/** The part of a sales order that an invoice is priced from. The unit price is the snapshot sales-service took. */
export type PayableOrder = {
  id: string;
  customerId: string;
  status: string;
  paymentStatus: string;
  currency: string;
  lines: Array<{
    productId: string;
    productUnitId: string;
    productNameSnapshot: string;
    quantity: string | number;
    unitPriceSnapshot: string | number;
  }>;
};

/** A refusal the route turns into an answer; `status` is the HTTP status and `code` the machine readable reason. */
export class InvoiceRefusal extends Error {
  public constructor(
    public readonly status: 400 | 404 | 409,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Decides which lines an invoice is made of. A shopper never sets a price: the invoice of a shopper is for one of
 * their own orders that still waits for payment, and its lines and unit prices are the ones sales-service snapshot
 * on that order, whatever the request carried. A member of staff enters an invoice by hand (a cash sale at the
 * counter, for instance), so staff keep the lines they sent.
 */
export const priceInvoiceRequest = async (input: {
  body: CreateInvoiceRequest;
  actorId: string | undefined;
  isEmployee: boolean;
  /** Reads the order as the shopper, so sales-service answers `undefined` for an order that is not theirs. */
  loadOrder: (orderId: string, actorId: string) => Promise<PayableOrder | undefined>;
}): Promise<CreateInvoiceRequest> => {
  if (input.isEmployee) return input.body;
  const { body, actorId } = input;
  if (!actorId || body.prescriptionId || !body.orderId)
    throw new InvoiceRefusal(400, "invalid_invoice_request", "A shopper invoice is for one of their own orders");
  const order = await input.loadOrder(body.orderId, actorId);
  if (!order) throw new InvoiceRefusal(404, "order_not_found", "Order not found");
  if (order.status !== "Pending" || order.paymentStatus !== "Pending")
    throw new InvoiceRefusal(409, "order_not_payable", "The order no longer waits for payment");
  return {
    ...body,
    lines: order.lines.map((line) => ({
      productId: line.productId,
      productUnitId: line.productUnitId,
      description: line.productNameSnapshot,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPriceSnapshot),
      currency: order.currency,
    })),
  };
};
