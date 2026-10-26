import { describe, expect, it } from "vitest";

import type { CreateInvoiceRequest } from "../contracts/payment.ts";

import { InvoiceRefusal, priceInvoiceRequest, type PayableOrder } from "./invoice-pricing.ts";

const orderId = "00000000-0000-4000-8000-000000000001";
const product = "00000000-0000-4000-8000-000000000002";
const unit = "00000000-0000-4000-8000-000000000003";

const order = (overrides: Partial<PayableOrder> = {}): PayableOrder => ({
  id: orderId,
  customerId: "shopper",
  status: "Pending",
  paymentStatus: "Pending",
  currency: "VND",
  deliveryFee: "0.00",
  lines: [
    {
      productId: product,
      productUnitId: unit,
      productNameSnapshot: "Paracetamol 500mg",
      quantity: "2.000000",
      unitPriceSnapshot: "45000.00",
    },
  ],
  ...overrides,
});

const request = (overrides: Partial<CreateInvoiceRequest> = {}): CreateInvoiceRequest => ({
  invoiceId: orderId,
  orderId,
  paymentMethod: "sepay_qr",
  lines: [
    { productId: product, productUnitId: unit, description: "cheap", quantity: 2, unitPrice: 1, currency: "VND" },
  ],
  ...overrides,
});

const price = (body: CreateInvoiceRequest, loaded: PayableOrder | undefined, isEmployee = false, actorId = "shopper") =>
  priceInvoiceRequest({ body, actorId, isEmployee, loadOrder: () => Promise.resolve(loaded) });

describe("pricing an invoice", () => {
  it("prices a shopper's invoice from the order, never from the request", async () => {
    const priced = await price(request(), order());
    expect(priced.lines).toStrictEqual([
      {
        productId: product,
        productUnitId: unit,
        description: "Paracetamol 500mg",
        quantity: 2,
        unitPrice: 45000,
        currency: "VND",
      },
    ]);
  });

  it("adds the delivery fee as a line without a product, so the invoice is the whole order total", async () => {
    const priced = await price(request(), order({ deliveryFee: "13000.00" }));
    expect(priced.lines).toHaveLength(2);
    expect(priced.lines[1]).toStrictEqual({
      description: "Phí giao hàng",
      quantity: 1,
      unitPrice: 13000,
      currency: "VND",
    });
    const total = priced.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    expect(total).toBe(2 * 45000 + 13000);
  });

  it("adds no fee line for an order with no delivery fee", async () => {
    expect((await price(request(), order())).lines).toHaveLength(1);
  });

  it("reads the order as the shopper who asked", async () => {
    const asked: string[] = [];
    await priceInvoiceRequest({
      body: request(),
      actorId: "shopper",
      isEmployee: false,
      loadOrder: (id, actorId) => {
        asked.push(`${id}:${actorId}`);
        return Promise.resolve(order());
      },
    });
    expect(asked).toStrictEqual([`${orderId}:shopper`]);
  });

  it("refuses an order that is not the shopper's, which sales answers as not found", async () => {
    await expect(price(request(), undefined)).rejects.toMatchObject({ status: 404, code: "order_not_found" });
  });

  it.each([
    ["cancelled", { status: "Cancelled" }],
    ["already confirmed", { status: "Confirmed" }],
    ["already paid", { paymentStatus: "Paid" }],
  ])("refuses an order that is %s", async (_label, overrides) => {
    await expect(price(request(), order(overrides))).rejects.toMatchObject({ status: 409, code: "order_not_payable" });
  });

  it("refuses a shopper invoice that names no order, or names a prescription", async () => {
    const { orderId: _omitted, ...withoutOrder } = request();
    await expect(price(withoutOrder, order())).rejects.toBeInstanceOf(InvoiceRefusal);
    await expect(price(request({ prescriptionId: orderId }), order())).rejects.toMatchObject({ status: 400 });
    await expect(price(request(), order(), false, "")).rejects.toMatchObject({ status: 400 });
  });

  it("keeps the lines that a member of staff entered by hand", async () => {
    const body = request({ paymentMethod: "cash" });
    await expect(price(body, undefined, true)).resolves.toBe(body);
  });
});
