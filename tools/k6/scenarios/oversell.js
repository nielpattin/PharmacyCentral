// Oversell invariant under contention: concurrent pickup orders race for one dedicated product with a fixed stock.
//
// Where the invariant is enforced (apps/sales-service, apps/inventory-service, apps/catalog-service):
// - Prices are server-side: `resolveOrderLines` (sales-routes.ts) takes each unit price from catalog `/pricing/active`,
//   and `createOrderRequestSchema` (contracts/sales.ts) strips every other field, so a client `unitPrice`/`total` never
//   reaches the order. Quantities must be positive numbers.
// - Holds happen when the order is placed: `POST /orders` commits the order (`createOrder`), then `OrderStock.hold`
//   calls inventory `POST /inventory/reservations` with the order id as reservation id. Inventory `reserve`
//   (inventory-repository.ts) locks the sellable balance rows with SELECT ... FOR UPDATE, allocates FEFO
//   (`allocateFefo`), and only then increments `quantity_reserved`. A shortfall throws `InsufficientStockError` inside
//   the transaction, which rolls the whole reservation back; the route answers 409 `insufficient_stock` and sales
//   cancels the order it already committed and releases its (empty) hold.
// - Give-back: cancelling (`POST /orders/:id/transition`) releases the hold; unpaid orders expire and are released by
//   `OrderStock.sweep`. A hand-over consumes the reservation. Nothing here cancels or hands over an order, so after the
//   run the reserved quantity must equal the accepted quantity.
// - Catalog availability (`/api/availability`) is a projection of `inStock` booleans only (availability-projection.ts),
//   so quantities are read from inventory balances (`/api/inventory/balances`): available = on_hand - reserved.
//
// Roles: setup imports the probe product as the Pharmacy Manager (catalog product imports are refused to Platform Admin
// with 403) and posts its opening balance as Warehouse Staff (inventory opening balances are refused to everyone else).
// The customer places the orders; the manager reads the probe back at teardown.
//
// Setup creates a probe product with a unique SKU and a single opening batch of STOCK units at the store. The main
// phase sends ORDERS pickup orders from VUS VUs as the demo customer, plus a few tampered bodies. Teardown reads the
// server's record back and checks the invariants with bounded waits for the eventually consistent projection.
import exec from "k6/execution";
import { sleep } from "k6";
import { Counter } from "k6/metrics";

import { accounts } from "../lib/config.js";
import { login, loginOncePerVu } from "../lib/session.js";

const STOCK = intEnv("STOCK", 20);
const ORDERS = intEnv("ORDERS", 60);
const VUS = intEnv("VUS", 30);
const MAX_QUANTITY = 3;
const ABSURD_QUANTITY = 1_000_000_000;
const PRICE = 12500;
const BATCH_EXPIRY = "2032-12-31";
const SETUP_WAIT_S = 60;
const SETTLE_WAIT_S = 30;
const ORDER_LIST_LIMIT = 500;
const LOOKBACK_MS = 5000;
// Global iteration numbers that send a tampered body instead of an honest order.
const TAMPERS = new Map([
  [3, "absurd_quantity"],
  [17, "negative_quantity"],
  [31, "forged_unit_price"],
  [45, "forged_total"],
]);
const VALIDATION_TAMPERS = ["absurd_quantity", "negative_quantity"];

const acceptedOrders = new Counter("orders_accepted");
const businessRejections = new Counter("business_rejections");
const invariantViolations = new Counter("invariant_violations");

export const options = {
  scenarios: {
    oversell: { executor: "shared-iterations", vus: VUS, iterations: ORDERS, maxDuration: "5m" },
  },
  setupTimeout: "3m",
  teardownTimeout: "3m",
  thresholds: { invariant_violations: ["count==0"] },
};

function intEnv(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return value;
}

const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const roundMoney = (value) => Math.round(value * 100) / 100;
const byCode = (left, right) => left.code.localeCompare(right.code);

/** Polls `read` until `isSettled` holds or `seconds` pass; returns the last value and whether it settled. */
function settle(read, isSettled, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let value = read();
  while (!isSettled(value) && Date.now() < deadline) {
    sleep(1);
    value = read();
  }
  return { value, settled: isSettled(value) };
}

export function setup() {
  const manager = login(accounts.manager);
  const warehouse = login(accounts.warehouse);
  const runId = Date.now().toString(36);
  const sku = `K6-OVS-${runId}`;
  const startedAt = Date.now();

  const stores = manager.get("/api/stores", { query: { limit: 50 }, name: "GET /stores" }).json();
  if (!Array.isArray(stores) || stores.length === 0) throw new Error("No customer-facing store to sell from");
  const store = stores[0];
  const locations = manager
    .get("/api/storage-locations", { query: { siteId: store.id }, name: "GET /storage-locations" })
    .json()
    .filter((location) => location.siteId === store.id && location.isActive)
    .sort(byCode);
  if (locations.length === 0) throw new Error(`Store ${store.code} has no active storage location`);
  const location = locations[0];

  const imported = manager.post(
    "/api/products/imports",
    {
      schemaVersion: 1,
      products: [
        {
          sku,
          name: `k6 oversell probe ${runId}`,
          units: [{ unitName: "Unit", conversionFactorToBaseUnit: 1, isBaseUnit: true, isDefaultSaleUnit: true }],
          price: { unitPrice: PRICE, currency: "VND", status: "Published", effectiveFrom: isoDay(-1) },
        },
      ],
    },
    { name: "POST /products/imports" },
  );
  if (imported.status !== 200) {
    throw new Error(`Product import failed with status ${imported.status}: ${String(imported.body).slice(0, 300)}`);
  }
  const product = waitForProduct(manager, sku);
  const unit = product.units.find((item) => item.isDefaultSaleUnit) ?? product.units[0];
  if (!unit) throw new Error(`Probe product ${sku} has no unit`);
  if (activePrice(manager, product.id, unit.id) !== PRICE) {
    throw new Error(`Probe product ${sku} does not read back its published price ${PRICE}`);
  }

  // Inventory resolves the product by id, so the import does not depend on the search index picking up the SKU.
  const balances = warehouse.post(
    "/api/inventory/imports/opening-balances",
    {
      schemaVersion: 1,
      balances: [
        {
          productId: product.id,
          siteId: store.id,
          storageLocationId: location.id,
          batchNumber: `K6-OVS-${runId}`,
          quantityOnHand: STOCK,
          expiryDate: BATCH_EXPIRY,
          qualityStatus: "Released",
          reason: `k6 oversell run ${runId}`,
        },
      ],
    },
    { name: "POST /inventory/imports/opening-balances" },
  );
  if (balances.status !== 200) {
    throw new Error(
      `Opening balance import failed with status ${balances.status}: ${String(balances.body).slice(0, 300)}`,
    );
  }

  const { value, settled } = settle(
    () => ({ stock: stockAt(manager, product.id, store.id), inStock: projectedInStock(manager, product.id, store.id) }),
    (current) => current.stock.onHand - current.stock.reserved === STOCK && current.inStock === true,
    SETUP_WAIT_S,
  );
  if (!settled) {
    throw new Error(
      `Probe ${sku} shows ${value.stock.onHand - value.stock.reserved} free and inStock=${value.inStock} at ${store.code} after ${SETUP_WAIT_S}s, expected ${STOCK}`,
    );
  }
  console.log(
    `oversell setup: ${sku} at ${store.code}/${location.code}, stock ${STOCK}, ${ORDERS} orders from ${VUS} VUs`,
  );
  return { runId, sku, startedAt, storeId: store.id, productId: product.id, productUnitId: unit.id };
}

function waitForProduct(manager, sku) {
  const { value } = settle(
    () => manager.get("/api/products", { query: { search: sku, limit: 20 } }).json(),
    (rows) => Array.isArray(rows) && rows.some((row) => row.sku === sku),
    SETUP_WAIT_S,
  );
  const match = Array.isArray(value) ? value.find((row) => row.sku === sku) : undefined;
  if (!match) throw new Error(`Probe product ${sku} is not searchable after ${SETUP_WAIT_S}s`);
  return match;
}

function activePrice(session, productId, productUnitId) {
  const response = session.get("/api/pricing/active", {
    query: { productId, productUnitId, effectiveDate: isoDay(0) },
    name: "GET /pricing/active",
    expect: [404],
  });
  return response.status === 200 ? Number(response.json().unitPrice) : undefined;
}

// Inventory's own numbers for the product at the site, summed over its batches and storage locations.
function stockAt(session, productId, siteId) {
  const rows = session.get("/api/inventory/balances", { query: { productId }, name: "GET /inventory/balances" }).json();
  if (!Array.isArray(rows)) throw new Error("Could not read inventory balances for the probe product");
  return rows
    .filter(({ balance }) => balance.siteId === siteId)
    .reduce(
      (total, { balance }) => ({
        onHand: total.onHand + Number(balance.quantityOnHand),
        reserved: total.reserved + Number(balance.quantityReserved),
      }),
      { onHand: 0, reserved: 0 },
    );
}

// The catalog projection carries only the in-stock flag, so it is checked against inventory's free quantity.
function projectedInStock(session, productId, siteId) {
  const rows = session.get("/api/availability", { query: { productId, siteId }, name: "GET /availability" }).json();
  const row = Array.isArray(rows)
    ? rows.find((item) => item.productId === productId && item.siteId === siteId)
    : undefined;
  return row?.inStock;
}

function orderBody(data, line, tamper) {
  const body = {
    selectedStoreId: data.storeId,
    fulfillmentType: "pickup",
    paymentMethod: "cash_on_delivery",
    lines: [line],
  };
  // The server must ignore these: the request schema strips unknown fields, and prices come from catalog.
  if (tamper === "forged_unit_price") body.lines = [{ ...line, unitPrice: 1, unitPriceSnapshot: 1 }];
  if (tamper === "forged_total") Object.assign(body, { subtotal: 1, deliveryFee: 0, total: 1 });
  return body;
}

function violation(check, detail) {
  invariantViolations.add(1, { check });
  console.error(`INVARIANT VIOLATED [${check}] ${detail}`);
}

// Accepted means 201. A rejection must be a business answer with a code (409 insufficient_stock, or 400 for the
// tampered quantities). A 5xx, or any other status, breaks the contract.
function classify(response, tamper, quantity) {
  const body = response.json() ?? {};
  if (response.status === 201) {
    acceptedOrders.add(1);
    if (!body.id) violation("accepted_without_order_id", `status 201 with no order id for quantity ${quantity}`);
    if (VALIDATION_TAMPERS.includes(tamper)) {
      violation(`${tamper}_accepted`, `order ${body.id} was created for quantity ${quantity}`);
    }
    return;
  }
  if (response.status === 409 && body.code === "insufficient_stock") {
    businessRejections.add(1, { reason: body.code });
    return;
  }
  if (VALIDATION_TAMPERS.includes(tamper) && response.status >= 400 && response.status < 500 && body.code) {
    businessRejections.add(1, { reason: body.code });
    return;
  }
  violation(
    "unexpected_response",
    `${tamper ?? "honest"} quantity ${quantity} answered ${response.status} ${body.code ?? ""}: ${String(response.body).slice(0, 200)}`,
  );
}

export default function (data) {
  const customer = loginOncePerVu(accounts.customer);
  const tamper = TAMPERS.get(exec.scenario.iterationInTest);
  let quantity = 1 + Math.floor(Math.random() * MAX_QUANTITY);
  if (tamper === "absurd_quantity") quantity = ABSURD_QUANTITY;
  if (tamper === "negative_quantity") quantity = -2;
  const line = { productId: data.productId, productUnitId: data.productUnitId, quantity };
  const response = customer.post("/api/orders", orderBody(data, line, tamper), {
    name: "POST /orders",
    expect: [400, 409, 422],
  });
  classify(response, tamper, quantity);
}

// The demo customer's pickup orders at the store since setup that contain the probe product, read back from the server.
// Each candidate is fetched, so an order the list shows but the detail cannot serve is a violation.
function probeOrders(customer, data, violations) {
  const list = customer.get("/api/orders", { query: { limit: ORDER_LIST_LIMIT }, name: "GET /orders" }).json();
  if (!Array.isArray(list)) throw new Error("Could not read the customer's order list");
  const since = data.startedAt - LOOKBACK_MS;
  if (list.length >= ORDER_LIST_LIMIT && Date.parse(list[list.length - 1].createdAt) >= since) {
    violations.push({
      check: "verification_incomplete",
      detail: `the order list is capped at ${ORDER_LIST_LIMIT} and still inside the run window`,
    });
  }
  const candidates = list.filter(
    (order) =>
      order.selectedStoreId === data.storeId &&
      order.paymentMethod === "cash_on_delivery" &&
      Date.parse(order.createdAt) >= since,
  );
  const found = [];
  for (const candidate of candidates) {
    const response = customer.get(`/api/orders/${candidate.id}`);
    if (response.status !== 200) {
      violations.push({
        check: "order_not_fetchable",
        detail: `order ${candidate.id} listed as ${candidate.status} answered ${response.status}`,
      });
      continue;
    }
    const order = response.json();
    if (order.lines.some((line) => line.productId === data.productId)) found.push(order);
  }
  return found;
}

export function teardown(data) {
  const manager = login(accounts.manager);
  const customer = login(accounts.customer);
  const violations = [];
  const price = activePrice(customer, data.productId, data.productUnitId);
  if (price === undefined) throw new Error(`Probe ${data.sku} has no active price at teardown`);

  const orders = probeOrders(customer, data, violations);
  const accepted = orders.filter((order) => order.status !== "Cancelled");
  const cancelled = orders.filter((order) => order.status === "Cancelled");
  const unitsOf = (order) => order.lines.reduce((total, line) => total + Number(line.quantity), 0);
  const acceptedUnits = accepted.reduce((total, order) => total + unitsOf(order), 0);

  // Inventory answers synchronously, but a hold given back by a failed release is repaired by the sweep, so wait.
  const { value } = settle(
    () => ({
      stock: stockAt(manager, data.productId, data.storeId),
      inStock: projectedInStock(manager, data.productId, data.storeId),
    }),
    (current) =>
      current.stock.reserved === acceptedUnits && current.inStock === current.stock.onHand - current.stock.reserved > 0,
    SETTLE_WAIT_S,
  );
  const { stock, inStock } = value;
  const available = stock.onHand - stock.reserved;

  if (acceptedUnits > STOCK) {
    violations.push({ check: "oversold", detail: `accepted ${acceptedUnits} units against stock ${STOCK}` });
  }
  if (available < 0) violations.push({ check: "negative_available", detail: `available ${available}` });
  if (stock.onHand !== STOCK || stock.reserved !== acceptedUnits) {
    violations.push({
      check: "inventory_mismatch",
      detail: `on hand ${stock.onHand} (expected ${STOCK}), reserved ${stock.reserved} (expected ${acceptedUnits} from accepted orders), available ${available}`,
    });
  }
  if (inStock !== available > 0) {
    violations.push({ check: "projection_stale", detail: `inStock=${inStock} while free=${available}` });
  }

  for (const order of accepted) {
    const line = order.lines[0];
    const quantity = Number(line?.quantity);
    const expected = roundMoney(price * quantity);
    const total = Number(order.subtotal) + Number(order.deliveryFee);
    if (order.lines.length !== 1 || !(quantity > 0)) {
      violations.push({ check: "order_missing_lines", detail: `order ${order.id} has ${order.lines.length} lines` });
    }
    if (Math.abs(total - expected) > 0.005) {
      violations.push({
        check: "total_not_server_price",
        detail: `order ${order.id}: total ${total} vs server price ${price} x ${quantity} = ${expected}`,
      });
    }
    if (Math.abs(Number(line?.unitPriceSnapshot) - price) > 0.005) {
      violations.push({
        check: "unit_price_not_server",
        detail: `order ${order.id}: unitPriceSnapshot ${line?.unitPriceSnapshot} vs server price ${price}`,
      });
    }
    if (order.stockHold !== "held") {
      violations.push({
        check: "order_hold_missing",
        detail: `order ${order.id} is ${order.status} with stockHold ${order.stockHold}`,
      });
    }
  }
  for (const order of cancelled) {
    if (order.stockHold === "held") {
      violations.push({
        check: "cancelled_order_holds_stock",
        detail: `order ${order.id} is Cancelled but still holds stock`,
      });
    }
  }

  console.log(
    `oversell teardown: accepted ${accepted.length} orders (${acceptedUnits} units), rejected ${cancelled.length} (cancelled by stock), ` +
      `stock on hand ${stock.onHand}, reserved ${stock.reserved}, available ${available}, projected inStock ${inStock}`,
  );
  if (violations.length === 0) {
    console.log("oversell invariants held: no oversell, inventory and projection agree, prices are server-side");
    return;
  }
  for (const order of orders) {
    console.error(
      `probe order ${order.id} status=${order.status} stockHold=${order.stockHold} qty=${unitsOf(order)} subtotal=${order.subtotal} createdAt=${order.createdAt}`,
    );
  }
  for (const { check, detail } of violations) violation(check, detail);
}
