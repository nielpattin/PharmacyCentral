// Customer checkout journey: browse, place an order, open its invoice, pay by SePay webhook, and wait until it is paid.
// About one order in five is cash on delivery instead, which only has to be accepted and stay unpaid.
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

import { pickProduct, pickStore } from "../lib/catalog.js";
import { accounts, profile, scenarioOptions } from "../lib/config.js";
import { postWebhook } from "../lib/sepay.js";
import { login, loginOncePerVu } from "../lib/session.js";

const orderToPaid = new Trend("order_to_paid_ms", true);
const businessRejections = new Counter("business_rejections");

const CASH_ON_DELIVERY_SHARE = 0.2;
const MAX_LINES = 2;
const MAX_QUANTITY = 3;
const PAID_WAIT_MS = 15000;
const POLL_INTERVAL_S = 0.25;
const STOCK_PER_LOCATION = 100000;
const OPENING_EXPIRY = "2032-12-31";
const PROJECTION_WAIT_S = 60;
// Refusals from the sales service that stock or pricing causes; they are normal at load, so they are not failures.
const BUSINESS_CODES = ["insufficient_stock", "product_unpriced"];

const breakpointRun = profile() === "breakpoint";

export const options = {
  scenarios: { checkout: scenarioOptions(profile()) },
  thresholds: breakpointRun
    ? {
        // Stops the run at the first minute the deployment is past saying "usable": 5% failures or a 3 s order.
        http_req_failed: [{ threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "40s" }],
        "http_req_duration{name:POST /orders}": [{ threshold: "p(95)<3000", abortOnFail: true, delayAbortEval: "40s" }],
      }
    : {
        http_req_failed: ["rate<0.01"],
        "http_req_duration{name:POST /orders}": ["p(95)<1500"],
        order_to_paid_ms: ["p(95)<8000"],
        checks: ["rate>0.99"],
      },
};

// Adds a large opening balance at every customer-facing store, then waits until catalog shows it in stock. The batch
// number is unique per run, so reruns never collide with an earlier import.
export function setup() {
  const admin = login(accounts.admin);
  const runId = Date.now().toString(36);
  const batchNumber = `K6-${runId}`;
  const stores = admin.get("/api/stores", { query: { limit: 50 }, name: "GET /stores" }).json();
  const listed = admin.get("/api/products", { query: { limit: 100 }, name: "GET /products" }).json();
  if (!Array.isArray(listed) || listed.length === 0) throw new Error("The catalog lists no products to stock");
  if (!Array.isArray(stores) || stores.length === 0) throw new Error("No customer-facing store to stock");
  // Inventory resolves each balance row's SKU through catalog search, and one SKU the search index has not caught up
  // with fails the whole import with 409 import_conflict. Stock only products that search resolves.
  const products = listed.filter((product) => isSearchable(admin, product.sku));
  if (products.length < listed.length) {
    console.warn(
      `${listed.length - products.length} of ${listed.length} products are not in the search index: skipped`,
    );
  }
  if (products.length === 0) throw new Error("No listed product is searchable, so none can be stocked");
  if (listed.length === 100) {
    console.warn("The product list is capped at 100: only the first 100 products get opening stock");
  }

  const balances = [];
  for (const store of stores) {
    const locations = admin
      .get("/api/storage-locations", { query: { siteId: store.id }, name: "GET /storage-locations" })
      .json()
      .filter((location) => location.siteId === store.id);
    for (const location of locations) {
      for (const product of products) {
        balances.push({
          productSku: product.sku,
          siteId: store.id,
          storageLocationId: location.id,
          batchNumber,
          quantityOnHand: STOCK_PER_LOCATION,
          expiryDate: OPENING_EXPIRY,
          qualityStatus: "Released",
          reason: `k6 load run ${runId}`,
        });
      }
    }
  }
  const response = admin.post(
    "/api/inventory/imports/opening-balances",
    { schemaVersion: 1, balances },
    { name: "POST /inventory/imports/opening-balances" },
  );
  if (response.status !== 200) {
    throw new Error(
      `Opening balance import failed with status ${response.status}: ${String(response.body).slice(0, 300)}`,
    );
  }
  for (const store of stores) waitForStock(admin, store.id, products.length);
  console.log(`opening balances: ${balances.length} rows under batch ${batchNumber}`);
  return { runId };
}

function isSearchable(admin, sku) {
  const rows = admin
    .get("/api/products", { query: { search: sku, limit: 100 }, name: "GET /products (sku lookup)" })
    .json();
  return Array.isArray(rows) && rows.some((row) => row.sku === sku);
}

// Availability is a projection that catalog updates from inventory events, so it lags the import by a moment.
function waitForStock(admin, storeId, expected) {
  const deadline = Date.now() + PROJECTION_WAIT_S * 1000;
  for (;;) {
    const rows = admin.get("/api/availability", { query: { siteId: storeId }, name: "GET /availability" }).json();
    const inStock = Array.isArray(rows) ? rows.filter((row) => row.inStock).length : 0;
    if (inStock >= expected) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Only ${inStock} of ${expected} products show in stock at ${storeId} after ${PROJECTION_WAIT_S}s`,
      );
    }
    sleep(1);
  }
}

export default function (data) {
  const customer = loginOncePerVu(accounts.customer);
  browse(customer);
  const store = pickStore(customer);
  const paymentMethod = Math.random() < CASH_ON_DELIVERY_SHARE ? "cash_on_delivery" : "sepay_qr";
  const lines = pickLines(customer, store.id);

  const startedAt = Date.now();
  const order = placeOrder(customer, store.id, paymentMethod, lines);
  if (order) {
    const invoice = openInvoice(customer, order, paymentMethod);
    if (invoice && paymentMethod === "sepay_qr") {
      payByTransfer(customer, data, { order, invoice, startedAt });
    } else if (invoice) {
      const current = customer.get(`/api/orders/${order.id}`).json();
      check(current, { "cash order still waits for payment at the counter": (o) => o?.paymentStatus === "Pending" });
    }
  }
  sleep(1);
}

function browse(customer) {
  const response = customer.get("/api/products", { query: { limit: 20 }, name: "GET /products" });
  check(response, { "product list loads": (r) => r.status === 200 });
}

function pickLines(customer, storeId) {
  const lines = [];
  const count = 1 + Math.floor(Math.random() * MAX_LINES);
  for (let index = 0; index < count; index++) {
    const unit = pickProduct(
      customer,
      storeId,
      lines.map((line) => line.productId),
    );
    if (!unit) break;
    lines.push({
      productId: unit.productId,
      productUnitId: unit.productUnitId,
      quantity: 1 + Math.floor(Math.random() * MAX_QUANTITY),
    });
  }
  return lines;
}

function isBusinessRefusal(response) {
  return response.status === 409 && BUSINESS_CODES.includes(response.json()?.code);
}

// Pickup orders only: the invoice amount is the sum of the order lines, which is the order total with no delivery fee.
function placeOrder(customer, storeId, paymentMethod, lines) {
  const response = customer.post(
    "/api/orders",
    { selectedStoreId: storeId, fulfillmentType: "pickup", paymentMethod, lines },
    { name: "POST /orders", expect: [409] },
  );
  if (isBusinessRefusal(response)) {
    businessRejections.add(1, { reason: response.json().code });
    return undefined;
  }
  check(response, { "order placed (201)": (r) => r.status === 201 });
  return response.status === 201 ? response.json() : undefined;
}

// The server's total for an order. The client never supplies prices, so this is the only number it compares against.
function orderTotal(order) {
  return Number(order.subtotal) + Number(order.deliveryFee);
}

function openInvoice(customer, order, paymentMethod) {
  const response = customer.post(
    "/api/payments/invoices",
    {
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
    },
    { name: "POST /payments/invoices" },
  );
  check(response, { "invoice created (201)": (r) => r.status === 201 });
  const invoice = response.json();
  check(invoice, {
    "invoice amount equals order total": (inv) => Number(inv?.amount) === orderTotal(order),
    "invoice waits for payment with a transfer code": (inv) =>
      inv?.status === "Pending" && Boolean(inv.paymentInstruction?.transferContent),
  });
  return response.status === 201 ? invoice : undefined;
}

function payByTransfer(customer, data, { order, invoice, startedAt }) {
  const instruction = invoice.paymentInstruction;
  if (!instruction) return;
  const amount = Number(invoice.amount);
  const transactionId = `k6-${data.runId}-${__VU}-${__ITER}`;
  const response = postWebhook({
    id: transactionId,
    gateway: "k6",
    transactionDate: new Date().toISOString().replace("T", " ").slice(0, 19),
    accountNumber: instruction.accountNumber,
    code: instruction.transferContent,
    content: instruction.transferContent,
    transferType: "in",
    transferAmount: amount,
    accumulated: amount,
    subAccount: null,
    referenceCode: transactionId,
    description: `${instruction.transferContent} k6 load`,
  });
  check(response, { "webhook accepted (200)": (r) => r.status === 200 && r.json()?.success === true });

  const paidOrder = waitForPaid(customer, order.id, startedAt);
  if (!check(paidOrder, { "order paid within the wait": (o) => o !== undefined })) return;
  orderToPaid.add(Date.now() - startedAt);
  check(paidOrder, { "order total equals the amount paid": (o) => orderTotal(o) === amount });

  const current = customer.get(`/api/payments/invoices/${invoice.id}`, { name: "GET /payments/invoices/:id" }).json();
  check(current, {
    "invoice paid for the order total": (inv) =>
      inv?.status === "Paid" && Number(inv.reconciliation?.receivedAmount) === amount,
  });
}

// Polls the order until its payment is recorded, giving up once PAID_WAIT_MS has passed since the order was placed.
function waitForPaid(customer, orderId, startedAt) {
  for (;;) {
    const order = customer.get(`/api/orders/${orderId}`).json();
    if (order?.paymentStatus === "Paid") return order;
    if (Date.now() - startedAt >= PAID_WAIT_MS) return undefined;
    sleep(POLL_INTERVAL_S);
  }
}
