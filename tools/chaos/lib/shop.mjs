// Checkout steps the scenarios repeat, mirroring tools/k6/scenarios/checkout.js (pickup orders, invoice, SePay transfer).

const pick = (items) => items[Math.floor(Math.random() * items.length)];

/** One in-stock, priced product at a random customer-facing store, as the order line the sales service accepts. */
export async function sellableLine(client) {
  const stores = await client.get("/api/stores", { limit: 50 });
  if (stores.status !== 200 || !Array.isArray(stores.body) || stores.body.length === 0) {
    throw new Error(`no customer-facing store (status ${stores.status})`);
  }
  const store = pick(stores.body);
  const availability = await client.get("/api/availability", { siteId: store.id });
  const inStock = new Set((availability.body ?? []).filter((row) => row.inStock).map((row) => row.productId));
  const products = await client.get("/api/products", { limit: 100 });
  const today = new Date().toISOString().slice(0, 10);
  for (const product of (products.body ?? []).filter((item) => inStock.has(item.id))) {
    const units = product.units ?? [];
    const unit = units.find((item) => item.isDefaultSaleUnit) ?? units.find((item) => item.isBaseUnit) ?? units[0];
    if (!unit) continue;
    const price = await client.get("/api/pricing/active", {
      productId: product.id,
      productUnitId: unit.id,
      effectiveDate: today,
    });
    if (price.status === 200) {
      return { store, line: { productId: product.id, productUnitId: unit.id, quantity: 1 } };
    }
  }
  throw new Error(`store ${store.id} has no in-stock product with an active price`);
}

/** A pickup order with one line at a store; `paymentMethod` is `cash_on_delivery` or `sepay_qr`. */
export function placeOrder(client, storeId, paymentMethod, lines) {
  return client.post("/api/orders", { selectedStoreId: storeId, fulfillmentType: "pickup", paymentMethod, lines });
}

/** The invoice for a placed order, with the order's own lines and total, as the k6 checkout opens it. */
export function openInvoice(client, order, paymentMethod) {
  return client.post("/api/payments/invoices", {
    invoiceId: order.id,
    orderId: order.id,
    paymentMethod,
    lines: order.lines.map((line) => ({
      productId: line.productId,
      productUnitId: line.productUnitId,
      description: line.productNameSnapshot,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPriceSnapshot),
      currency: order.currency,
    })),
  });
}

/** A SePay transfer payload for an invoice returned by `openInvoice`, paying its full amount. */
export function transferFor(invoice, transactionId) {
  const instruction = invoice.paymentInstruction;
  const amount = Number(invoice.amount);
  return {
    id: transactionId,
    gateway: "chaos",
    transactionDate: new Date().toISOString().replace("T", " ").slice(0, 19),
    accountNumber: instruction.accountNumber,
    code: instruction.transferContent,
    content: instruction.transferContent,
    transferType: "in",
    transferAmount: amount,
    accumulated: amount,
    subAccount: null,
    referenceCode: transactionId,
    description: `${instruction.transferContent} chaos`,
  };
}

/** A minimal valid PNG (1x1), enough to pass the intake's image check. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
