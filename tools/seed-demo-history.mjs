// Demo history, the last step of `pnpm run seed:demo`: what a pharmacy that has traded for two months looks like.
// It buys stock with goods receipts that record a unit cost, sells for 60 days (counter prescriptions and online
// orders), then backdates those documents so the trend charts, gross profit, stock health and replenishment
// suggestions have something to show. It also leaves batches near and past expiry and a few dead-stock products.
//
// No API accepts a past creation time for an order or a payment, so the backdating is SQL, run by the `runSql` the
// caller passes in: the compose Postgres locally, the ops ECS task on the AWS demo stack (tools/lib/sql-batch.mjs and
// tools/lib/aws-ops.mjs). That is the one thing this file does outside the HTTP API, and seed-demo refuses
// NODE_ENV=production and any remote API_BASE_URL unless DEMO_SEED_TARGET=cloud says it is the AWS demo stack.
// It runs once: a database that already has goods receipt GR-HIST-001 is left as it is, with a warning when the
// history has aged. `pnpm run demo:reset` wipes the service databases and seeds again, so everything is dated today.
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

import { datasets, csvRows } from "../apps/staff-web/src/import-datasets.ts";

const DAY = 86_400_000;
const HISTORY_DAYS = 60;

// Products the history sells: [sku, weight, smallest quantity, largest quantity, step]. Quantities are in the product's
// sale unit. Prescription-only medicines are sold at the counter only (online orders refuse them).
const sellable = [
  ["THU-0001", 10, 10, 40, 10],
  ["THU-0004", 9, 10, 30, 10],
  ["THU-0006", 8, 10, 20, 10],
  ["THU-0003", 6, 10, 30, 10],
  ["THU-0010", 8, 2, 8, 1],
  ["THU-0017", 6, 10, 20, 10],
  ["THU-0018", 4, 10, 20, 10],
  ["THU-0019", 7, 10, 30, 10],
  ["THU-0020", 5, 10, 20, 10],
  ["THU-0023", 4, 10, 30, 10],
  ["THU-0025", 6, 2, 6, 1],
  ["THU-0027", 5, 10, 20, 10],
  ["THU-0031", 6, 10, 20, 10],
  ["THU-0032", 5, 10, 30, 10],
  ["THU-0033", 3, 1, 2, 1],
  ["THU-0034", 3, 1, 2, 1],
  ["THU-0035", 4, 20, 60, 20],
  ["THU-0036", 4, 1, 2, 1],
  ["VTYT-001", 8, 1, 3, 1],
  ["VTYT-002", 5, 2, 6, 1],
  ["VTYT-003", 2, 1, 1, 1],
  ["VTYT-004", 3, 1, 1, 1],
  ["VTYT-005", 4, 1, 1, 1],
  ["VTYT-006", 2, 1, 1, 1],
  ["VTYT-008", 3, 1, 1, 1],
  ["VTYT-009", 6, 1, 4, 1],
  ["VTYT-010", 6, 1, 3, 1],
  ["VTYT-011", 3, 1, 2, 1],
  ["VTYT-012", 3, 1, 3, 1],
  ["VTYT-013", 1, 1, 1, 1],
  ["VTYT-014", 1, 1, 1, 1],
  ["VTYT-016", 4, 1, 3, 1],
  // Prescription-only medicines with a price.
  ["THU-0002", 7, 10, 20, 10],
  ["THU-0005", 5, 10, 30, 10],
  ["THU-0007", 5, 30, 60, 30],
  ["THU-0016", 3, 7, 14, 7],
  ["THU-0026", 3, 6, 12, 6],
  ["THU-0028", 4, 14, 28, 14],
  ["THU-0030", 4, 28, 56, 28],
].map(([sku, weight, min, max, step]) => ({ sku, weight, min, max, step }));

// Stock that ends the history thin against its recent sales, so the replenishment suggestions have shortfalls.
// The value is what the shop already holds from the opening balances, which sells after the received batch.
const shortfallSkus = new Map([
  ["THU-0004", 60],
  ["THU-0006", 50],
  ["THU-0019", 90],
  ["THU-0010", 90],
  ["VTYT-001", 30],
]);
// Products with no movement for more than 90 days: dead stock.
const deadStockSkus = ["THU-0014", "VTYT-020", "VTYT-017", "THU-0009", "THU-0015", "THU-0013"];
// Batches received at the shop with an expiry relative to the day of the seed: [sku, batch, days to expiry, quantity].
// A negative number is already expired.
const expiringBatches = [
  ["THU-0022", "LOT-H-EXP-06", 6, 14],
  ["THU-0012", "LOT-H-EXP-12", 12, 18],
  ["THU-0011", "LOT-H-EXP-20", 20, 24],
  ["THU-0024", "LOT-H-EXP-27", 27, 12],
  ["VTYT-019", "LOT-H-EXP-45", 45, 30],
  ["VTYT-007", "LOT-H-EXP-X8", -8, 20],
];

const patients = [
  "Nguyễn Thị Hoa",
  "Trần Quốc Hùng",
  "Lê Văn Phúc",
  "Phạm Thị Mai",
  "Võ Minh Tâm",
  "Đặng Thu Hà",
  "Bùi Văn Long",
  "Hoàng Thị Lan",
  "Ngô Quang Vinh",
  "Dương Thị Ngọc",
];
const doctors = ["BS. Nguyễn Văn An", "BS. Lê Thị Bích", "BS. Trần Minh Quân", "BS. Phạm Hồng Nhung"];
const shoppers = [
  ["khachhang@pharmacycentral.vn", 5],
  ["nguyen.lan@example.com", 2],
  ["tran.minh.khoa@example.com", 2],
  ["le.thanh.huong@example.com", 2],
  ["pham.quoc.viet@example.com", 1],
  ["vo.ngoc.mai@example.com", 1],
  ["dang.hoang.nam@example.com", 1],
];
const deliveryPoints = [
  { latitude: 10.7769, longitude: 106.7009 },
  { latitude: 10.7295, longitude: 106.7218 },
];

// A small deterministic generator, so the same seed gives the same shop every time.
const randomFrom = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isoDay = (millis) => new Date(millis).toISOString().slice(0, 10);
const inDays = (days) => isoDay(Date.now() + days * DAY);
const uuidList = (ids) => ids.map((id) => `'${id}'`).join(",");

export async function seedHistory({ baseUrl, admin, signIn, requireEnv, runSql }) {
  const random = randomFrom(20261029);
  const pick = (items, weightOf) => {
    let roll = random() * items.reduce((sum, item) => sum + weightOf(item), 0);
    for (const item of items) {
      roll -= weightOf(item);
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  };
  const between = (low, high) => low + Math.floor(random() * (high - low + 1));

  const manager = await signIn({ email: "manager@pharmacycentral.vn" });
  // A second manager raises the purchase orders, because nobody approves an order they made.
  const buyer = await signIn({ email: "manager2@pharmacycentral.vn" });
  const warehouse = await signIn({ email: "warehouse@pharmacycentral.vn" });
  const pharmacist = await signIn({ email: "pharmacist@pharmacycentral.vn" });
  const sessions = new Map();
  for (const [email] of shoppers) sessions.set(email, await signIn({ email }));

  const call = async (session, path, { method = "GET", body, headers = {} } = {}) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await session.call(path, {
          method,
          body,
          headers,
        });
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        if (attempt >= 4 || !/-> (429|502|503|504)/.test(message)) throw error;
        await sleep(1_000 * (attempt + 1));
      }
    }
  };

  const catalog = (path) => call(admin, path);
  const sites = new Map((await catalog("/api/sites?limit=100")).map((row) => [row.code, row]));
  const suppliers = new Map((await catalog("/api/suppliers?limit=100")).map((row) => [row.code, row]));
  const locations = new Map((await catalog("/api/storage-locations?limit=100")).map((row) => [row.code, row]));
  const products = new Map();
  for (const row of await admin.call("/api/products?limit=100")) products.set(row.sku, row);
  const need = (value, what) => {
    if (!value) throw new Error(`The demo history needs ${what}; import the sample data first.`);
    return value;
  };
  const retail = need(sites.get("SITE-RTL"), "site SITE-RTL");
  const front = need(locations.get("RTL-FRONT"), "storage location RTL-FRONT");

  const existingReceipt = await call(admin, "/api/procurement/goods-receipts?q=GR-HIST-001&limit=50");
  if (existingReceipt.some((row) => row.receiptNumber === "GR-HIST-001")) {
    // GR-HIST-EXP was received exactly 40 days before the history was seeded, so it dates the seed.
    const marker = (await call(admin, "/api/procurement/goods-receipts?q=GR-HIST-EXP&limit=50")).find(
      (row) => row.receiptNumber === "GR-HIST-EXP",
    );
    const ageDays = marker ? Math.floor((Date.now() - (Date.parse(marker.receivedAt) + 40 * DAY)) / DAY) : undefined;
    console.log("demo history: already seeded (GR-HIST-001 exists), nothing added");
    if (ageDays === undefined || ageDays >= 1)
      console.warn(
        `WARNING: this history was seeded ${ageDays === undefined ? "at an unknown time" : `${ageDays} day(s) ago`}. ` +
          "Its newest sale, its expiry countdowns and its action plans have aged since. Run pnpm run demo:reset before presenting.",
      );
    return;
  }

  // Prices come from the same file the catalog import reads.
  const priced = new Map();
  for (const row of datasets.catalog.fromCsv(
    csvRows(await readFile(new URL("../data/import-samples/products.csv", import.meta.url), "utf8")),
  ).products) {
    if (row.price)
      priced.set(row.sku, { price: Number(row.price.unitPrice), prescription: row.prescriptionRequired === true });
  }
  for (const item of sellable) need(priced.get(item.sku), `a price for ${item.sku}`);
  const unitIds = new Map();
  const saleUnit = async (sku) => {
    if (!unitIds.has(sku)) {
      const units = await catalog(`/api/products/${need(products.get(sku), `product ${sku}`).id}/units`);
      unitIds.set(sku, need(units.find((unit) => unit.isDefaultSaleUnit) ?? units[0], `a sale unit for ${sku}`).id);
    }
    return unitIds.get(sku);
  };

  // 1. The plan: which documents are sold on which day.
  const now = Date.now();
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const documents = [];
  for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo -= 1) {
    const dayStart = startOfToday - daysAgo * DAY;
    const weekday = new Date(dayStart + 12 * 3_600_000).getDay();
    const growth = ((HISTORY_DAYS - daysAgo) / HISTORY_DAYS) * 2.2;
    const count = Math.max(
      1,
      Math.round(2.2 + growth + (weekday === 0 || weekday === 6 ? 1 : 0) + (random() - 0.5) * 2),
    );
    for (let index = 0; index < count; index += 1) {
      const counter = random() < 0.45;
      const choices = counter ? sellable : sellable.filter((item) => !priced.get(item.sku).prescription);
      const lineCount = between(1, counter ? 3 : 4);
      const lines = new Map();
      for (let line = 0; line < lineCount; line += 1) {
        const item = pick(choices, (entry) => entry.weight);
        const steps = (item.max - item.min) / item.step;
        lines.set(item.sku, item.min + Math.floor(random() * (steps + 1)) * item.step);
      }
      const at = dayStart + between(8 * 60, 21 * 60) * 60_000;
      const outcome = random();
      documents.push({
        kind: counter ? "counter" : "online",
        at,
        lines: [...lines],
        payment: random() < 0.6 ? "qr" : "cash",
        delivery: !counter && random() < 0.2,
        fate: outcome < 0.9 ? "completed" : outcome < 0.96 ? "cancelled" : "refunded",
        shopper: pick(shoppers, ([, weight]) => weight)[0],
        patient: patients[between(0, patients.length - 1)],
        doctor: doctors[between(0, doctors.length - 1)],
      });
    }
  }
  const soldUnits = new Map();
  for (const document of documents) {
    if (document.fate !== "completed") continue;
    for (const [sku, quantity] of document.lines) soldUnits.set(sku, (soldUnits.get(sku) ?? 0) + quantity);
  }
  console.log(`demo history: ${documents.length} sales documents planned over ${HISTORY_DAYS} days`);

  // 2. Purchases: one approved purchase order per supplier, received in full with a unit cost on every line.
  const supplierOf = (sku) => {
    const number = Number(sku.slice(-2));
    return sku.startsWith("VTYT")
      ? number % 2
        ? "SUP-003"
        : "SUP-004"
      : ["SUP-001", "SUP-002", "SUP-005"][number % 3];
  };
  const costRatio = (sku) => 0.58 + (Number(sku.slice(-2)) % 7) * 0.02;
  const bySupplier = new Map();
  for (const item of sellable) {
    const sold = soldUnits.get(item.sku) ?? 0;
    const velocity = sold / HISTORY_DAYS;
    // Thin stock at the end for the shortfall products, a comfortable shelf for the rest.
    const quantity = shortfallSkus.has(item.sku)
      ? Math.max(item.min * 2, Math.round(sold - shortfallSkus.get(item.sku) + velocity * 1.5 + 5))
      : Math.max(item.min * 3, Math.round(sold * 1.15 + 20));
    const code = supplierOf(item.sku);
    bySupplier.set(code, [...(bySupplier.get(code) ?? []), { ...item, quantity }]);
  }
  const purchaseOrders = [];
  const receipts = [];
  let sequence = 0;
  for (const [code, items] of [...bySupplier].sort(([a], [b]) => a.localeCompare(b))) {
    sequence += 1;
    const number = String(sequence).padStart(3, "0");
    const orderedAt = now - (74 - sequence * 2) * DAY;
    const receivedAt = orderedAt + between(3, 6) * DAY;
    const order = await call(buyer, "/api/procurement/purchase-orders", {
      method: "POST",
      body: {
        purchaseOrderNumber: `PO-HIST-${number}`,
        supplierId: need(suppliers.get(code), `supplier ${code}`).id,
        siteId: retail.id,
        expectedDate: new Date(now + 7 * DAY).toISOString().slice(0, 10),
        lines: items.map((item) => ({ productId: products.get(item.sku).id, orderedQuantity: item.quantity })),
      },
    });
    await call(manager, `/api/procurement/purchase-orders/${order.id}/action`, {
      method: "POST",
      body: { action: "approve" },
    });
    const receipt = await call(warehouse, "/api/procurement/goods-receipts", {
      method: "POST",
      body: {
        receiptNumber: `GR-HIST-${number}`,
        supplierId: suppliers.get(code).id,
        siteId: retail.id,
        storageLocationId: front.id,
        purchaseOrderId: order.id,
        receivedAt: new Date(receivedAt).toISOString(),
        lines: items.map((item) => ({
          productId: products.get(item.sku).id,
          batchNumber: `LOT-H-${item.sku.slice(-4)}`,
          manufacturedDate: inDays(-120),
          // Between 8 and 20 months out, spread by product, never near expiry.
          expiryDate: inDays(240 + (Number(item.sku.slice(-2)) % 13) * 30),
          quantity: item.quantity,
          unitCost: Math.round(priced.get(item.sku).price * costRatio(item.sku) * 100) / 100,
        })),
      },
    });
    purchaseOrders.push({ id: order.id, at: orderedAt, receivedAt });
    receipts.push({ id: receipt.id, at: receivedAt });
  }
  // Batches that expire soon, or already have, received with a cost like the rest.
  const expiringReceipt = await call(warehouse, "/api/procurement/goods-receipts", {
    method: "POST",
    body: {
      receiptNumber: "GR-HIST-EXP",
      supplierId: suppliers.get("SUP-001").id,
      siteId: retail.id,
      storageLocationId: front.id,
      receivedAt: new Date(now - 40 * DAY).toISOString(),
      lines: expiringBatches.map(([sku, batchNumber, , quantity]) => ({
        productId: need(products.get(sku), `product ${sku}`).id,
        batchNumber,
        manufacturedDate: inDays(-120),
        expiryDate: inDays(400),
        quantity,
        unitCost: Math.round(need(priced.get(sku), `a price for ${sku}`).price * 0.65 * 100) / 100,
      })),
    },
  });
  receipts.push({ id: expiringReceipt.id, at: now - 40 * DAY });

  // New batches wait for quality review, and Pharmacy Manager releases them.
  let balances = [];
  const reload = async () => {
    balances = await call(admin, "/api/inventory/balances?limit=500");
  };
  await reload();
  for (const { batch } of balances) {
    if (batch.batchNumber.startsWith("LOT-H-") && batch.qualityStatus === "PendingQc") {
      await call(manager, `/api/inventory/batches/${batch.id}/quality`, {
        method: "POST",
        body: { decision: "release", notes: "Đạt kiểm tra nhập kho" },
      });
    }
  }
  await reload();

  // 3. The sales themselves, oldest first, as they would be placed.
  const sePaySecret = requireEnv("SEPAY_WEBHOOK_SECRET");
  let transactionNumber = 2_000_000;
  const sePayWebhook = async (invoice) => {
    transactionNumber += 1;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      id: transactionNumber,
      transferType: "in",
      transferAmount: Number(invoice.amount),
      content: `${invoice.paymentCode} thanh toan don hang`,
      gateway: "Vietcombank",
    });
    const signature = createHmac("sha256", sePaySecret).update(`${timestamp}.`).update(body).digest("hex");
    const response = await fetch(new URL("/api/payments/sepay/webhook", baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SePay-Timestamp": timestamp,
        "X-SePay-Signature": `sha256=${signature}`,
      },
      body,
    });
    if (!response.ok) throw new Error(`The SePay webhook answered ${response.status}`);
  };
  const untilOrder = async (shopper, id, ready) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const order = await call(shopper, `/api/orders/${id}`);
      if (ready(order)) return;
      await sleep(400);
    }
    throw new Error(`Order ${id} did not reach the expected payment state`);
  };
  const transition = (id, status) =>
    call(manager, `/api/orders/${id}/transition`, { method: "POST", body: { status } });

  const placed = [];
  let skipped = 0;
  const sellOnline = async (document) => {
    const shopper = sessions.get(document.shopper);
    const created = await call(shopper, "/api/orders", {
      method: "POST",
      body: {
        selectedStoreId: retail.id,
        fulfillmentType: document.delivery ? "delivery" : "pickup",
        paymentMethod: document.payment === "qr" ? "sepay_qr" : "cash_on_delivery",
        lines: await Promise.all(
          document.lines.map(async ([sku, quantity]) => ({
            productId: products.get(sku).id,
            productUnitId: await saleUnit(sku),
            quantity,
          })),
        ),
        ...(document.delivery
          ? { delivery: { destination: deliveryPoints[between(0, 1)], addressNote: "Gọi trước khi giao" } }
          : {}),
      },
    });
    const invoice = await call(shopper, "/api/payments/invoices", {
      method: "POST",
      body: {
        invoiceId: created.id,
        orderId: created.id,
        paymentMethod: document.payment === "qr" ? "sepay_qr" : "cash_on_delivery",
        lines: created.lines.map((line) => ({
          productId: line.productId,
          productUnitId: line.productUnitId,
          description: line.productNameSnapshot,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPriceSnapshot),
          currency: created.currency,
        })),
      },
      headers: { "Idempotency-Key": created.id },
    });
    placed.push({ id: created.id, at: document.at });
    if (document.fate === "cancelled") {
      await transition(created.id, "Cancelled");
      return;
    }
    if (document.payment === "qr") {
      await sePayWebhook(invoice);
      await untilOrder(shopper, created.id, (order) => order.paymentStatus === "Paid");
    }
    const steps = document.delivery
      ? ["Preparing", "Ready", "Delivering", "Completed"]
      : ["Preparing", "Ready", "Completed"];
    for (const status of document.payment === "cash" ? ["Confirmed", ...steps] : steps) {
      if (document.fate === "refunded" && status !== "Confirmed" && status !== "Preparing") break;
      // An order cannot be completed before its cash is recorded, so the cash is taken just before Completed.
      if (status === "Completed" && document.payment === "cash" && document.fate === "completed") {
        await call(pharmacist, `/api/payments/${invoice.id}/confirm-counter`, {
          method: "POST",
          body: {},
        });
        await untilOrder(shopper, created.id, (order) => order.paymentStatus === "Paid");
      }
      await transition(created.id, status);
    }
    if (document.fate === "refunded") {
      if (document.payment === "cash")
        await call(pharmacist, `/api/payments/${invoice.id}/confirm-counter`, {
          method: "POST",
          body: {},
        });
      await call(manager, `/api/payments/${invoice.id}/refund`, {
        method: "POST",
        body: { reason: "Khách đổi ý, hoàn tiền toàn bộ" },
      });
      await untilOrder(shopper, created.id, (order) => order.status === "Cancelled");
    }
  };
  // What can still be sold from a batch: on hand minus what open orders and prescriptions have reserved.
  const availableOf = ({ balance }) => Number(balance.quantityOnHand) - Number(balance.quantityReserved ?? 0);
  const eligibleRows = (sku) =>
    balances
      .filter(
        ({ balance, batch }) =>
          batch.productId === products.get(sku).id &&
          batch.qualityStatus === "Released" &&
          balance.siteId === retail.id &&
          balance.storageLocationId === front.id &&
          new Date(batch.expiryDate).getTime() > now,
      )
      .sort((a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate));
  const stockOf = (sku, quantity = 1) => eligibleRows(sku).find((row) => availableOf(row) >= quantity);
  // A counter sale dispenses from one batch; an online order can draw on all of them.
  const capacityOf = (sku, counter) => {
    const available = eligibleRows(sku).map(availableOf);
    return counter
      ? Math.max(0, ...available)
      : Math.max(
          0,
          available.reduce((sum, value) => sum + value, 0),
        );
  };
  const sellAtCounter = async (document) => {
    const rows = document.lines.map(([sku, quantity]) => ({ sku, quantity, row: stockOf(sku, quantity) }));
    if (rows.some(({ row }) => !row)) {
      skipped += 1;
      return;
    }
    const created = await call(pharmacist, "/api/prescriptions", {
      method: "POST",
      body: {
        siteId: retail.id,
        storageLocationId: front.id,
        patientName: document.patient,
        patientPhone: "0901234567",
        doctorName: document.doctor,
        lines: await Promise.all(
          rows.map(async ({ sku, quantity }) => ({
            productId: products.get(sku).id,
            productUnitId: await saleUnit(sku),
            prescribedQuantity: quantity,
            dosage: "Theo chỉ định của bác sĩ",
            duration: "5 ngày",
          })),
        ),
      },
    });
    placed.push({ id: created.id, at: document.at });
    if (document.fate === "cancelled") {
      await call(pharmacist, `/api/prescriptions/${created.id}/cancel`, { method: "POST", body: {} });
      return;
    }
    await call(pharmacist, `/api/prescriptions/${created.id}/dispense`, {
      method: "POST",
      body: {
        lines: created.lines.map((line, index) => ({
          prescriptionLineId: line.id,
          productBatchId: rows[index].row.balance.productBatchId,
          dispensedQuantity: rows[index].quantity,
        })),
      },
    });
    for (const { row, quantity } of rows) row.balance.quantityOnHand = Number(row.balance.quantityOnHand) - quantity;
    const invoice = await call(pharmacist, `/api/payments/prescriptions/${created.id}`, {
      method: "POST",
      body: {},
    });
    await call(pharmacist, `/api/payments/${invoice.id}/confirm-counter`, {
      method: "POST",
      body: {},
    });
  };

  let done = 0;
  let unfilled = 0;
  for (const document of documents) {
    // Fresh balances, then fit the sale to the stock that is really free: a line is cut down to what is available and
    // dropped when nothing is, so a sale never asks for stock the shelf does not have.
    await reload();
    document.lines = document.lines
      .map(([sku, quantity]) => [sku, Math.min(quantity, capacityOf(sku, document.kind === "counter"))])
      .filter(([, quantity]) => quantity > 0);
    if (document.lines.length === 0) {
      unfilled += 1;
      done += 1;
      continue;
    }
    try {
      if (document.kind === "online") await sellOnline(document);
      else await sellAtCounter(document);
    } catch (error) {
      // A line that ran out of stock or a refused order must not stop the rest of the shop's history.
      skipped += 1;
      console.warn(
        `demo history: skipped one ${document.kind} sale: ${String(error instanceof Error ? error.message : error).split("\n")[0]}`,
      );
    }
    done += 1;
    if (done % 20 === 0) {
      await reload();
      console.log(`demo history: ${done}/${documents.length} sales`);
    }
  }
  await reload();

  // 4. A few more requests from the shop floor for what ran short, then the shopper carts.
  for (const sku of ["THU-0019", "VTYT-001"]) {
    const row = stockOf(sku);
    if (!row) continue;
    await call(pharmacist, "/api/inventory/replenishment", {
      method: "POST",
      body: {
        siteId: retail.id,
        storageLocationId: front.id,
        notes: `Bổ sung ${sku} theo gợi ý đặt hàng`,
        lines: [
          {
            productId: row.batch.productId,
            productBatchId: row.balance.productBatchId,
            requestedQuantity: 60,
            reason: "Sắp hết hàng",
          },
        ],
      },
    });
  }
  const cartOf = async (email, items) => {
    const shopper = sessions.get(email);
    await call(shopper, "/api/carts/merge", {
      method: "POST",
      body: {
        lines: await Promise.all(
          items.map(async ([sku, quantity, selected]) => ({
            productId: products.get(sku).id,
            productUnitId: await saleUnit(sku),
            quantity,
            selected,
          })),
        ),
      },
    });
  };
  await cartOf("khachhang@pharmacycentral.vn", [
    ["THU-0010", 4, true],
    ["VTYT-005", 1, false],
    ["THU-0003", 20, false],
  ]);
  await cartOf("nguyen.lan@example.com", [
    ["VTYT-001", 2, true],
    ["VTYT-009", 1, false],
  ]);

  // 5. Backdate. Wait for the read models to catch up with the events first, so their rows move too.
  const auditCount = async () =>
    Number(
      (
        await runSql([{ database: "operations_query_service", script: "select count(*) from audit_events;" }])
      )[0].trim(),
    );
  let previous = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const count = await auditCount();
    if (count === previous) break;
    previous = count;
    await sleep(2_500);
  }

  const targetOf = new Map(placed.map(({ id, at }) => [id, at]));
  const ids = [...targetOf.keys()];
  const anchors = new Map();
  const shiftTable = (map) =>
    `create temp table s(id uuid primary key, d interval);
       insert into s values ${[...map].map(([id, millis]) => `('${id}', '${millis} milliseconds'::interval)`).join(",")};`;
  // Everything that rewrites dates goes out as one batch (one SQL session), after one batch that reads what to shift.
  const writes = [];
  if (ids.length > 0) {
    const [rows, invoiceRows] = await runSql([
      {
        database: "sales_service",
        script: `select id, (extract(epoch from created_at) * 1000)::bigint from orders where id in (${uuidList(ids)})
       union all select id, (extract(epoch from created_at) * 1000)::bigint from prescriptions where id in (${uuidList(ids)});`,
      },
      {
        database: "payment_service",
        script: `select id, coalesce(order_id, prescription_id) from payment_invoices
       where order_id in (${uuidList(ids)}) or prescription_id in (${uuidList(ids)});`,
      },
    ]);
    for (const line of rows.trim().split("\n").filter(Boolean)) {
      const [id, millis] = line.split("|");
      anchors.set(id, Number(millis));
    }
    const shifts = new Map([...anchors].map(([id, anchor]) => [id, anchor - targetOf.get(id)]));
    const shiftsWithInvoices = new Map(shifts);
    for (const line of invoiceRows.trim().split("\n").filter(Boolean)) {
      const [invoiceId, documentId] = line.split("|");
      shiftsWithInvoices.set(invoiceId, shifts.get(documentId));
    }
    const ofInvoice = "(i.order_id = s.id or i.prescription_id = s.id)";
    writes.push(
      {
        database: "sales_service",
        script: `${shiftTable(shifts)}
       update orders o set created_at = o.created_at - s.d, updated_at = o.updated_at - s.d,
         paid_at = case when o.paid_at is null then null else o.paid_at - s.d end from s where o.id = s.id;
       update order_delivery_snapshots x set created_at = x.created_at - s.d from s where x.order_id = s.id;
       update prescriptions p set created_at = p.created_at - s.d, updated_at = p.updated_at - s.d,
         dispensed_at = p.dispensed_at - s.d,
         paid_at = case when p.paid_at is null then null else p.paid_at - s.d end from s where p.id = s.id;`,
      },
      {
        database: "payment_service",
        script: `${shiftTable(shifts)}
       update payment_invoices i set created_at = i.created_at - s.d, updated_at = i.updated_at - s.d from s where ${ofInvoice};
       update payment_attempts a set created_at = a.created_at - s.d, updated_at = a.updated_at - s.d
         from s join payment_invoices i on ${ofInvoice} where a.payment_invoice_id = i.id;
       update payment_transactions t set received_at = t.received_at - s.d
         from s join payment_invoices i on ${ofInvoice} where t.payment_invoice_id = i.id;
       update payment_refunds r set created_at = r.created_at - s.d
         from s join payment_invoices i on ${ofInvoice} where r.payment_invoice_id = i.id;`,
      },
      {
        database: "inventory_service",
        script: `${shiftTable(shifts)}
       update stock_ledger_entries e set occurred_at = e.occurred_at - s.d, created_at = e.created_at - s.d
         from s where e.reference_id = s.id;
       update stock_reservations r set created_at = r.created_at - s.d, updated_at = r.updated_at - s.d
         from s where r.owner_id = s.id;`,
      },
      {
        database: "operations_query_service",
        script: `${shiftTable(shiftsWithInvoices)}
       update audit_events a set occurred_at = a.occurred_at - s.d from s where a.entity_id = s.id;
       update finance_entries f set occurred_at = f.occurred_at - s.d from s where f.payload like '%' || s.id::text || '%';
       update report_rows r set occurred_at = r.occurred_at - s.d
         from s where r.subject_id = s.id or r.payload like '%' || s.id::text || '%';`,
      },
    );
  }

  // Purchases happened before the sales: orders about two months ago, receipts a few days after each.
  const stamp = (millis) => `'${new Date(millis).toISOString()}'::timestamptz`;
  const purchaseSql = [
    ...purchaseOrders.map(
      ({ id, at, receivedAt }) =>
        `update purchase_orders set created_at = ${stamp(at)}, approved_at = ${stamp(at + DAY)},
           updated_at = ${stamp(receivedAt)} where id = '${id}';`,
    ),
    ...receipts.map(
      ({ id, at }) => `update goods_receipts set received_at = ${stamp(at)} where id = '${id}';
        update stock_ledger_entries set occurred_at = ${stamp(at)}, created_at = ${stamp(at)} where reference_id = '${id}';
        update product_batches set quality_reviewed_at = ${stamp(at + DAY)}
          where (product_id, batch_number) in (
            select product_id, batch_number from goods_receipt_lines where goods_receipt_id = '${id}');`,
    ),
  ].join("\n");
  const purchaseIds = [...purchaseOrders.map(({ id }) => id), ...receipts.map(({ id }) => id)];
  // Opening stock was counted a while ago. The dead-stock products were counted longest ago and never moved since.
  const deadIds = deadStockSkus.map((sku) => need(products.get(sku), `product ${sku}`).id);
  writes.push(
    { database: "inventory_service", script: purchaseSql },
    {
      database: "operations_query_service",
      script: `update audit_events set occurred_at = ${stamp(now - 60 * DAY)} where entity_id in (${uuidList(purchaseIds)});`,
    },
    {
      database: "inventory_service",
      script: `update stock_ledger_entries set occurred_at = ${stamp(now - 130 * DAY)}, created_at = ${stamp(now - 130 * DAY)}
       where movement_type = 'OpeningBalance' and product_id in (${uuidList(deadIds)});
     update stock_ledger_entries set occurred_at = ${stamp(now - 78 * DAY)}, created_at = ${stamp(now - 78 * DAY)}
       where movement_type = 'OpeningBalance' and product_id not in (${uuidList(deadIds)});`,
    },
    // Expiry dates last, so the sales above never ran into a batch that was about to be unavailable.
    {
      database: "inventory_service",
      script: expiringBatches
        .map(
          ([, batch, days]) =>
            `update product_batches set expiry_date = current_date + ${days} where batch_number = '${batch}';`,
        )
        .join("\n"),
    },
  );
  await runSql(writes);
  console.log(
    `demo history: ${placed.length} sales documents backdated over ${HISTORY_DAYS} days (${skipped} skipped, ${unfilled} not sold for lack of stock), ` +
      `${purchaseOrders.length} purchase orders and ${receipts.length} goods receipts with unit costs, ` +
      `${expiringBatches.length} batches near or past expiry, ${deadStockSkus.length} dead-stock products`,
  );
}

// What the warehouse account sees at its own site (SITE-WH): goods receipts, replenishment requests, returns, an open
// and a posted stocktake, and adjustments. The shop-side steps above never touch SITE-WH, so without this the
// warehouse screens would be empty. Warehouse Staff creates, and the Pharmacy Manager decides, because nobody approves
// their own record. Runs once: goods receipt GR-WH-001 marks it.
export async function seedWarehouseActivity({ admin, signIn }) {
  const warehouse = await signIn({ email: "warehouse@pharmacycentral.vn" });
  const manager = await signIn({ email: "manager@pharmacycentral.vn" });
  const buyer = await signIn({ email: "manager2@pharmacycentral.vn" });
  const call = (session, path, options) => session.call(path, options);
  const need = (value, what) => {
    if (!value) throw new Error(`The warehouse demo activity needs ${what}; import the sample data first.`);
    return value;
  };
  const existing = await call(warehouse, "/api/procurement/goods-receipts?q=GR-WH-001&limit=50");
  if (existing.some((row) => row.receiptNumber === "GR-WH-001")) {
    console.log("warehouse activity: already seeded (GR-WH-001 exists), nothing added");
    return;
  }
  const sites = new Map((await call(admin, "/api/sites?limit=100")).map((row) => [row.code, row]));
  const suppliers = new Map((await call(admin, "/api/suppliers?limit=100")).map((row) => [row.code, row]));
  const locations = new Map((await call(admin, "/api/storage-locations?limit=100")).map((row) => [row.code, row]));
  const products = new Map();
  for (const row of await admin.call("/api/products?limit=100")) products.set(row.sku, row);
  const warehouseSite = need(sites.get("SITE-WH"), "site SITE-WH");
  const balances = await call(admin, "/api/inventory/balances?limit=500");
  const stock = (sku) =>
    need(
      balances.find(
        ({ balance, batch }) =>
          batch.productId === products.get(sku)?.id &&
          batch.qualityStatus === "Released" &&
          balance.siteId === warehouseSite.id &&
          Number(balance.quantityOnHand) > 0,
      ),
      `released stock of ${sku} at SITE-WH`,
    );
  const day = 86_400_000;
  const supplier = need(suppliers.get("SUP-002"), "supplier SUP-002");
  const location = need(locations.get("WH-A"), "storage location WH-A");

  // Receiving: three goods receipts and one purchase order waiting for approval.
  const purchaseOrder = async (number, lines) => {
    const created = await call(buyer, "/api/procurement/purchase-orders", {
      method: "POST",
      body: {
        purchaseOrderNumber: number,
        supplierId: supplier.id,
        siteId: warehouseSite.id,
        expectedDate: new Date(Date.now() + 5 * day).toISOString().slice(0, 10),
        lines: lines.map(([sku, orderedQuantity]) => ({ productId: products.get(sku).id, orderedQuantity })),
      },
    });
    return created;
  };
  const receive = (number, order, lines) =>
    call(warehouse, "/api/procurement/goods-receipts", {
      method: "POST",
      body: {
        receiptNumber: number,
        supplierId: supplier.id,
        siteId: warehouseSite.id,
        storageLocationId: location.id,
        ...(order ? { purchaseOrderId: order.id } : {}),
        receivedAt: new Date(Date.now() - 2 * day).toISOString(),
        lines: lines.map(([sku, quantity, batchNumber, unitCost]) => ({
          productId: products.get(sku).id,
          batchNumber,
          manufacturedDate: inDays(-60),
          expiryDate: inDays(600),
          quantity,
          unitCost,
        })),
      },
    });
  // Replenishment of the warehouse site: one waiting, one approved, one rejected. The manager raises them and
  // Warehouse Staff decides.
  const replenish = async (notes, sku, requestedQuantity, action) => {
    const row = stock(sku);
    const created = await call(manager, "/api/inventory/replenishment", {
      method: "POST",
      body: {
        siteId: warehouseSite.id,
        storageLocationId: row.balance.storageLocationId,
        notes,
        lines: [
          {
            productId: row.batch.productId,
            productBatchId: row.balance.productBatchId,
            requestedQuantity,
            reason: "Sắp hết hàng",
          },
        ],
      },
    });
    if (action)
      await call(warehouse, `/api/inventory/replenishment/${created.id}/${action}`, {
        method: "POST",
        body: { reviewNotes: null },
      });
  };
  await replenish("Kho A sắp hết hàng bán chạy", "THU-0031", 200, undefined);
  await replenish("Chuẩn bị đợt khuyến mãi cuối tháng", "THU-0032", 150, "approve");
  await replenish("Đã đủ hàng sau đợt nhập", "THU-0033", 40, "reject");

  // Returns to the supplier.
  for (const [reason, sku, quantity] of [
    ["Lô bị móp hộp khi giao", "THU-0031", 6],
    ["Nhà cung cấp thu hồi lô", "THU-0033", 4],
  ]) {
    const row = stock(sku);
    await call(warehouse, "/api/inventory/returns", {
      method: "POST",
      body: {
        siteId: warehouseSite.id,
        reason,
        lines: [
          {
            productBatchId: row.balance.productBatchId,
            storageLocationId: row.balance.storageLocationId,
            quantity,
            destination: "Trả nhà cung cấp",
          },
        ],
      },
    });
  }

  // Stocktakes: Warehouse Staff counts, Platform Admin posts one and leaves one open.
  const stocktake = async (notes, skus, shouldPost) => {
    // One stocktake counts one storage location, so only the products held where the first one is held are counted.
    const found = skus.map(stock);
    const rows = found.filter((row) => row.balance.storageLocationId === found[0].balance.storageLocationId);
    const created = await call(warehouse, "/api/inventory/stocktakes", {
      method: "POST",
      body: {
        siteId: warehouseSite.id,
        storageLocationId: rows[0].balance.storageLocationId,
        notes,
        lines: rows.map((row) => ({ productBatchId: row.balance.productBatchId })),
      },
    });
    if (!shouldPost) return;
    const detail = await call(warehouse, `/api/inventory/stocktakes/${created.id}`);
    for (const line of detail.lines ?? []) {
      const counted = Number(line.systemQuantity) - (line === detail.lines[0] ? 2 : 0);
      await call(warehouse, `/api/inventory/stocktake-lines/${line.id}/count`, {
        method: "POST",
        body: { countedQuantity: counted },
      });
    }
    await call(manager, `/api/inventory/stocktakes/${created.id}/post`, { method: "POST", body: {} });
  };
  await stocktake("Kiểm kê định kỳ kho A", ["THU-0031", "THU-0032"], true);
  await stocktake("Kiểm kê đột xuất kệ vật tư", ["THU-0010"], false);

  // Adjustments: one waiting, one approved, one rejected.
  const adjust = async (reason, sku, adjustmentType, quantity, decision) => {
    const row = stock(sku);
    const created = await call(warehouse, "/api/inventory/adjustments", {
      method: "POST",
      body: {
        productId: row.batch.productId,
        productBatchId: row.balance.productBatchId,
        siteId: warehouseSite.id,
        storageLocationId: row.balance.storageLocationId,
        adjustmentType,
        quantity,
        reason,
      },
    });
    if (decision)
      await call(manager, `/api/inventory/adjustments/${created.id}/${decision}`, { method: "POST", body: {} });
  };
  await adjust("Hàng hỏng do ẩm khi lưu kho", "THU-0032", "Negative", 8, undefined);
  await adjust("Kiểm đếm thấy thừa", "THU-0010", "Positive", 12, "approve");
  await adjust("Ghi nhầm số lượng", "THU-0033", "Negative", 5, "reject");
  // Last, because goods receipt GR-WH-001 is the marker that this step has run. These goods are received without an
  // order, and the one order raised for the site waits for approval.
  await receive("GR-WH-001", undefined, [
    ["THU-0001", 300, "LOT-WH-0001", 250],
    ["THU-0004", 200, "LOT-WH-0004", 420],
  ]);
  await receive("GR-WH-002", undefined, [["THU-0006", 150, "LOT-WH-0006", 330]]);
  await receive("GR-WH-003", undefined, [["THU-0019", 200, "LOT-WH-0019", 430]]);
  await purchaseOrder("PO-WH-001", [
    ["VTYT-001", 200],
    ["THU-0027", 300],
  ]);

  // The received batches wait for quality review. The manager releases all but the last, which stays pending.
  const fresh = await call(admin, "/api/inventory/balances?limit=500");
  for (const { batch } of fresh) {
    if (!batch.batchNumber.startsWith("LOT-WH-") || batch.qualityStatus !== "PendingQc") continue;
    if (batch.batchNumber === "LOT-WH-0019") continue;
    await call(manager, `/api/inventory/batches/${batch.id}/quality`, {
      method: "POST",
      body: { decision: "release", notes: "Đạt kiểm tra nhập kho" },
    });
  }

  console.log(
    "warehouse activity: receipts, replenishment, returns, stocktakes and adjustments at SITE-WH are in place",
  );
}
