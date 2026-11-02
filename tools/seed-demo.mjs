// Demo seed (B): the demo and reference dataset, opt-in. Run it after the default seed (A, `pnpm run seed:default`),
// which creates the one admin this signs in as. It never creates or changes that admin.
// Development and the AWS demo stack only. Refuses NODE_ENV=production and any API_BASE_URL that is not a loopback host,
// unless DEMO_SEED_TARGET=cloud (set by tools/aws-seed.mjs, `pnpm run cloud:seed`) says it is the AWS demo stack.
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { datasets, csvRows } from "../apps/staff-web/src/import-datasets.ts";
import { uploadProductImages } from "../apps/catalog-service/scripts/upload-product-images.mjs";
import { seedHistory, seedWarehouseActivity } from "./seed-demo-history.mjs";
import { pendingSynonymGroup, searchSynonymGroups } from "./lib/demo-synonyms.mjs";
import { awsSqlRunner, runOpsTask } from "./lib/aws-ops.mjs";
import { localSqlRunner } from "./lib/sql-batch.mjs";

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Set it in your .env file.`);
  return value;
};

if (process.env.NODE_ENV === "production") {
  throw new Error("seed-demo is a development tool and refuses to run with NODE_ENV=production.");
}

const baseUrl = new URL(requireEnv("API_BASE_URL"));
// The AWS demo stack is reached over HTTPS, its database through the ops ECS task, its images through the real bucket.
const remote = process.env.DEMO_SEED_TARGET === "cloud";
if (remote) {
  if (baseUrl.protocol !== "https:")
    throw new Error(`DEMO_SEED_TARGET=cloud needs an https API_BASE_URL, got ${baseUrl.origin}.`);
} else if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error(
    `Refusing to import sample data into ${baseUrl.origin}: only a local gateway is allowed. For the AWS demo stack run pnpm run cloud:seed.`,
  );
}
const adminEmail = "admin@pharmacycentral.vn";
const pharmacistEmail = "pharmacist@pharmacycentral.vn";
const managerEmail = "manager@pharmacycentral.vn";
const secondManagerEmail = "manager2@pharmacycentral.vn";
const warehouseEmail = "warehouse@pharmacycentral.vn";
const customerEmail = "khachhang@pharmacycentral.vn";
const adminPassword = requireEnv("ADMIN_PASSWORD");
const demoPassword = requireEnv("DEMO_ACCOUNT_PASSWORD");

// Every date the dataset carries is relative to the day it is seeded, so a shelf that "expires in 52 days" says so
// whenever the seed runs. The sample CSVs hold their dates against this day (the day they were written); the seed moves
// each one by the days that have passed since.
const SAMPLE_DATA_DAY = "2026-10-29";
const DAY_MS = 86_400_000;
const isoDay = (millis) => new Date(millis).toISOString().slice(0, 10);
const inDays = (days) => isoDay(Date.now() + days * DAY_MS);
const shiftToToday = (isoDate) =>
  isoDate ? isoDay(Date.parse(isoDate) + (Date.parse(inDays(0)) - Date.parse(SAMPLE_DATA_DAY))) : isoDate;

const request = async (path, { method = "GET", body, headers = {} } = {}) => {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    const issues = (json?.errors ?? []).map((issue) => `\n  - ${issue.path}: ${issue.message}`).join("");
    const code = json?.code ? ` [${json.code}]` : "";
    throw new Error(
      `${method} ${path} -> ${response.status}${code} ${json?.detail ?? json?.title ?? text.slice(0, 200)}${issues}`,
    );
  }
  return json;
};

// Each account logs in once and keeps its access token; `call` sends it as a bearer.
const signIn = async ({ email }) => {
  let accessToken;
  const call = async (path, { headers, ...options } = {}) => {
    return request(path, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...headers } });
  };
  try {
    const account = await request("/api/auth/login", {
      method: "POST",
      body: { email, password: email === adminEmail ? adminPassword : demoPassword },
    });
    accessToken = account.accessToken;
    return { id: account.id, call };
  } catch (error) {
    throw new Error(
      `Could not sign in as ${email} through ${baseUrl.origin}. Is the gateway reachable (pnpm run dev:infra, and ` +
        `host networking on Docker Desktop) and are the services running (pnpm dev)?\n` +
        String(error instanceof Error ? error.message : error),
      { cause: error },
    );
  }
};

// Same folding as foldSearchText in apps/catalog-service search-text.ts, so accent variants count as existing.
const foldSearchTerm = (text) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ|Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
const synonymKey = (terms) => JSON.stringify([...new Set(terms.map(foldSearchTerm))].sort());

const pnpm = process.env.npm_execpath;
// The one place that seeds the demo accounts: the identity-service demo seed, run through the same pnpm.
const seedArgs = ["--dir", "apps/identity-service", "seed:demo"];
if (!pnpm && !remote) throw new Error("Run this through pnpm: pnpm run seed:demo");
const seedAccounts = async ({ show = false } = {}) => {
  if (remote) {
    const { exitCode, text } = await runOpsTask({ label: "accounts", command: ["node", "/ops/seed-demo.mjs"] });
    if (show) console.log(text);
    if (exitCode !== 0)
      throw new Error(`seeding the accounts failed (exit ${exitCode})
${text}`);
    return;
  }
  // pnpm 12 ships as a native binary. Older installs set npm_execpath to a .js file that node must run.
  const [command, args] = /\.[cm]?js$/.test(pnpm) ? [process.execPath, [pnpm, ...seedArgs]] : [pnpm, seedArgs];
  const result = spawnSync(command, args, { encoding: "utf8", stdio: show ? "inherit" : "pipe" });
  if (result.status !== 0) {
    throw new Error(
      `seeding the accounts failed (exit ${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
};

// The default admin comes from seed A. Checking it first fails before anything is written.
const admin = await signIn({ email: adminEmail }).catch((error) => {
  throw new Error(
    "The default admin cannot sign in. Run pnpm run seed:default first (ADMIN_PASSWORD in .env), then this again.\n" +
      String(error instanceof Error ? error.message : error),
    { cause: error },
  );
});
// Locally the images go to the Floci bucket. On AWS, aws-upload-media.mjs puts them in the real bucket and writes a copy of
// products.csv whose image URLs point there (tmp/aws-demo/products.csv), which the catalog import below reads.
let uploadedImageUrls;
if (remote) {
  console.log("Uploading product images to the AWS media bucket...");
  const upload = spawnSync(process.execPath, ["tools/aws-upload-media.mjs"], {
    encoding: "utf8",
    env: { ...process.env, AWS_ENDPOINT_URL_S3: "" },
  });
  if (upload.status !== 0)
    throw new Error(`Uploading the product images failed:
${upload.stdout}${upload.stderr}`);
} else {
  console.log("Uploading product images to Floci S3...");
  uploadedImageUrls = new Set(
    (await uploadProductImages(fileURLToPath(new URL("../data/product-images/images", import.meta.url)))).map(
      ({ imageUrl }) => imageUrl,
    ),
  );
}
const runSql = remote ? awsSqlRunner() : localSqlRunner({ postgresUser: requireEnv("POSTGRES_USER") });

// Who imports each dataset, as in the app: Platform Admin only creates the sites (it has no import), the Pharmacy
// Manager imports master data and Warehouse Staff imports opening stock. The two accounts exist once the sites do.
const importers = { sites: admin };

// Platform Admin creates a site by hand, one at a time, because the import is the manager's.
const createSites = async (sites) => {
  const known = new Set((await admin.call("/api/sites?limit=100")).map((row) => row.code));
  const missing = sites.filter((site) => !known.has(site.code));
  for (const site of missing) {
    await admin.call("/api/sites", {
      method: "POST",
      body: site,
    });
  }
  return { created: missing.length, existing: sites.length - missing.length };
};

const order = ["sites", "storageLocations", "suppliers", "catalog", "openingBalances"];
for (const id of order) {
  const dataset = datasets[id];
  const file =
    remote && id === "catalog"
      ? new URL("../tmp/aws-demo/products.csv", import.meta.url)
      : new URL(`../data/import-samples/${dataset.fileBase}.csv`, import.meta.url);
  const payload = dataset.fromCsv(csvRows(await readFile(file, "utf8")));
  if (id === "openingBalances") {
    for (const row of payload.balances) {
      row.expiryDate = shiftToToday(row.expiryDate);
      // A batch is never made after today, whatever the sample file says.
      if (row.manufacturedDate) row.manufacturedDate = [shiftToToday(row.manufacturedDate), inDays(-30)].sort()[0];
    }
  }
  if (id === "openingBalances")
    await waitForSearchIndex(
      admin,
      payload.balances.map((row) => row.productSku),
    );
  if (id === "catalog" && uploadedImageUrls) {
    const missing = payload.products.filter((row) => row.imageUrl && !uploadedImageUrls.has(row.imageUrl));
    if (missing.length > 0) {
      console.warn(
        `Warning: ${missing.length} product(s) point at an image that was not uploaded: ${missing.map((row) => row.sku).join(", ")}`,
      );
    }
  }
  if (id === "sites") {
    console.log(`${dataset.label}: ${JSON.stringify(await createSites(payload.sites))}`);
    // Right after the sites exist, so each account is created with its site access in one pass.
    console.log("Seeding demo accounts...");
    await seedAccounts({ show: true });
    importers.storageLocations = importers.suppliers = importers.catalog = await signIn({ email: managerEmail });
    importers.openingBalances = await signIn({ email: warehouseEmail });
    continue;
  }
  const importer = importers[id];
  let result;
  try {
    result = await importer.call(dataset.endpoint, {
      method: "POST",
      body: payload,
    });
  } catch (error) {
    // Opening balances are for an empty location. Once stock has moved (the demo transfers do that), the same file
    // no longer matches, so the stock is left as it is.
    if (
      id !== "openingBalances" ||
      !String(error instanceof Error ? error.message : error).includes("[import_conflict]")
    )
      throw error;
    console.log(`${dataset.label}: skipped, stock has moved since the first import`);
    continue;
  }
  console.log(`${dataset.label}: ${JSON.stringify(result?.summary ?? result)}`);
}
// After the accounts, so the pharmacist's session carries SITE-RTL access when it approves.
console.log("Seeding search synonyms...");
await seedSearchSynonyms(await signIn({ email: managerEmail }));
console.log("Seeding demo activity (transfers, adjustments, purchase orders, orders)...");
await seedActivity();
console.log("Seeding demo history (receipts with costs, 60 days of sales, expiring and dead stock)...");
await seedHistory({ baseUrl, admin, signIn, requireEnv, runSql });
console.log("Seeding warehouse activity (receiving, replenishment, returns, stocktakes, adjustments)...");
await seedWarehouseActivity({ admin, signIn });
console.log("Done. Every step is idempotent, so running this again is safe.");

// The search index picks up new products asynchronously, and inventory-service resolves SKUs through it. Stock rows
// for a brand-new SKU therefore wait here.
async function waitForSearchIndex(session, skus) {
  const deadline = Date.now() + 60_000;
  for (const sku of new Set(skus)) {
    for (;;) {
      const rows = await session.call(`/api/products?search=${encodeURIComponent(sku)}&limit=100`);
      if (rows.some((row) => row.sku === sku)) break;
      if (Date.now() > deadline)
        throw new Error(`Product ${sku} is not searchable yet; run the command again in a minute.`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

async function seedSearchSynonyms(proposer) {
  const { items } = await proposer.call("/api/products/search-synonyms");
  const groupsByKey = new Map();
  for (const group of items) {
    const key = synonymKey(group.terms);
    groupsByKey.set(key, [...(groupsByKey.get(key) ?? []), group]);
  }

  let created = 0;
  let alreadyApproved = 0;
  const toApprove = [];
  for (const terms of searchSynonymGroups) {
    const existing = groupsByKey.get(synonymKey(terms)) ?? [];
    if (existing.some((group) => group.status === "approved")) {
      alreadyApproved += 1;
      continue;
    }
    const submitted = existing.find((group) => group.submittedBy === proposer.id);
    if (submitted) {
      toApprove.push(submitted);
      continue;
    }
    if (existing.length > 0) {
      console.warn(`Search synonym "${terms.join(", ")}" is pending from another employee. Approve it in staff-web.`);
      continue;
    }
    const group = await proposer.call("/api/products/search-synonyms", {
      method: "POST",
      body: { terms },
    });
    created += 1;
    toApprove.push(group);
  }

  if (!groupsByKey.has(synonymKey(pendingSynonymGroup))) {
    await proposer.call("/api/products/search-synonyms", {
      method: "POST",
      body: { terms: pendingSynonymGroup },
    });
    created += 1;
  }

  let approved = 0;
  if (toApprove.length > 0) {
    const pharmacist = await signIn({ email: pharmacistEmail });
    for (const group of toApprove) {
      await pharmacist.call(`/api/products/search-synonyms/${group.id}/approve`, {
        method: "POST",
        body: { version: group.version },
      });
      approved += 1;
    }
  }
  console.log(`search synonyms: created ${created}, approved ${approved}, already approved ${alreadyApproved}`);
}

// Demo activity, so the list screens have rows in every state. Each record has a fixed number and is skipped when it
// already exists, so running the command again adds nothing. The first manager approves what the second one and the
// warehouse account create, as two people must. Platform Admin only reads.
async function seedActivity() {
  const manager = await signIn({ email: managerEmail });
  const buyer = await signIn({ email: secondManagerEmail });
  const warehouse = await signIn({ email: warehouseEmail });
  const pharmacist = await signIn({ email: pharmacistEmail });
  const customer = await signIn({ email: customerEmail });
  const sites = new Map((await admin.call("/api/sites?limit=100")).map((row) => [row.code, row]));
  const suppliers = new Map((await admin.call("/api/suppliers?limit=100")).map((row) => [row.code, row]));
  const locations = new Map((await admin.call("/api/storage-locations?limit=100")).map((row) => [row.code, row]));
  const balances = await admin.call("/api/inventory/balances?limit=500");
  const products = new Map();
  for (const row of await admin.call("/api/products?limit=100")) products.set(row.sku, row);
  const need = (value, what) => {
    if (!value) throw new Error(`Demo activity needs ${what}; import the sample data first.`);
    return value;
  };
  const stock = (sku, siteCode, locationCode) => {
    const row = need(
      balances.find(
        ({ balance, batch }) =>
          batch.productId === products.get(sku)?.id &&
          batch.qualityStatus === "Released" &&
          balance.siteId === sites.get(siteCode)?.id &&
          balance.storageLocationId === locations.get(locationCode)?.id,
      ),
      `released stock of ${sku} at ${locationCode}`,
    );
    return {
      productId: row.batch.productId,
      productBatchId: row.balance.productBatchId,
      siteId: row.balance.siteId,
      storageLocationId: row.balance.storageLocationId,
    };
  };
  const existing = async (path, number) => {
    const rows = await admin.call(`${path}?q=${encodeURIComponent(number)}&limit=50`, {});
    return rows.find((row) => Object.values(row).includes(number));
  };
  const post = async (session, path, body) => session.call(path, { method: "POST", body });

  // Transfers: one waiting for approval, one in transit, one received.
  const transfer = async (number, sku, quantity, steps, fromLocation = "WH-A") => {
    if (await existing("/api/inventory/transfers", number)) return;
    const source = stock(sku, "SITE-WH", fromLocation);
    const created = await post(warehouse, "/api/inventory/transfers", {
      transferNumber: number,
      sourceSiteId: sites.get("SITE-WH").id,
      destinationSiteId: sites.get("SITE-RTL").id,
      lines: [
        {
          productId: source.productId,
          productBatchId: source.productBatchId,
          sourceStorageLocationId: source.storageLocationId,
          destinationStorageLocationId: locations.get("RTL-FRONT").id,
          quantity,
        },
      ],
    });
    // The manager approves, and Warehouse Staff ships at the source site and receives at the destination site.
    const actors = { approve: manager, ship: warehouse, receive: warehouse };
    for (const step of steps) await post(actors[step], `/api/inventory/transfers/${created.id}/${step}`, {});
  };
  await transfer("TR-DEMO-001", "THU-0031", 30, []);
  await transfer("TR-DEMO-002", "THU-0004", 40, ["approve", "ship"]);
  await transfer("TR-DEMO-003", "THU-0006", 25, ["approve", "ship", "receive"], "WH-B");

  // Adjustments: one pending, one approved, one rejected.
  const adjust = async (reason, sku, type, quantity, decision) => {
    const rows = await admin.call("/api/inventory/adjustments?limit=100");
    if (rows.some((row) => row.reason === reason)) return;
    const row = stock(sku, "SITE-RTL", "RTL-FRONT");
    const created = await post(warehouse, "/api/inventory/adjustments", {
      productId: row.productId,
      productBatchId: row.productBatchId,
      siteId: row.siteId,
      storageLocationId: row.storageLocationId,
      adjustmentType: type,
      quantity,
      reason,
    });
    if (decision) await post(manager, `/api/inventory/adjustments/${created.id}/${decision}`, {});
  };
  await adjust("Hộp bị ẩm khi kiểm kệ", "THU-0004", "Negative", 3, undefined);
  await adjust("Kiểm đếm thấy thừa", "THU-0006", "Positive", 2, "approve");
  await adjust("Ghi nhầm số lượng", "THU-0031", "Negative", 10, "reject");

  // Purchase orders: one approved, one waiting, one cancelled.
  const purchaseOrder = async (number, sku, quantity, action) => {
    // The first manager decides on the orders the second manager raised.
    const decide = (id) => post(manager, `/api/procurement/purchase-orders/${id}/action`, { action });
    const found = await existing("/api/procurement/purchase-orders", number);
    if (found) {
      // An earlier run may have stopped before the decision; deciding twice is refused, which is fine here.
      if (action) await decide(found.id).catch(() => undefined);
      return;
    }
    const created = await post(buyer, "/api/procurement/purchase-orders", {
      purchaseOrderNumber: number,
      supplierId: suppliers.get("SUP-001").id,
      siteId: sites.get("SITE-RTL").id,
      expectedDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      lines: [{ productId: products.get(sku).id, orderedQuantity: quantity }],
    });
    if (action) await decide(created.id);
  };
  await purchaseOrder("PO-DEMO-001", "THU-0001", 500, "approve");
  await purchaseOrder("PO-DEMO-002", "THU-0025", 200, undefined);
  await purchaseOrder("PO-DEMO-003", "THU-0034", 100, "cancel");

  // Online orders: pickup at the store, one in each of a few states.
  const orders = await admin.call("/api/orders?limit=50");
  if (orders.length === 0) {
    const unitFor = async (sku) => {
      const units = await admin.call(`/api/products/${products.get(sku).id}/units`);
      return need(units.find((unit) => unit.isDefaultSaleUnit) ?? units[0], `a sale unit for ${sku}`);
    };
    // Each order is placed the way checkout places it: the order, then its payment invoice under the same id. A QR
    // order is paid by a signed SePay webhook, a cash order by the counter; the rest wait for payment, as a real queue
    // does. `paid` says how far the order got: "qr" or "cash" settles it, and `refunded` returns the money after.
    const sePaySecret = requireEnv("SEPAY_WEBHOOK_SECRET");
    const sePayWebhook = async (invoice, transactionId) => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({
        id: transactionId,
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
    /** Payment reaches the order through RabbitMQ, so wait until the order shows it before moving the order on. */
    const untilOrder = async (shopper, id, ready) => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const order = await shopper.call(`/api/orders/${id}`);
        if (ready(order)) return order;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`Order ${id} did not reach the expected payment state`);
    };
    let transactionNumber = 1_000_000;
    const place = async ({ shopper, payment, lines, steps = [], paid, refunded = false, deliverTo, note }) => {
      const created = await shopper.call("/api/orders", {
        method: "POST",
        body: {
          selectedStoreId: sites.get("SITE-RTL").id,
          fulfillmentType: deliverTo ? "delivery" : "pickup",
          paymentMethod: payment,
          lines: await Promise.all(
            lines.map(async ([sku, quantity]) => ({
              productId: products.get(sku).id,
              productUnitId: (await unitFor(sku)).id,
              quantity,
            })),
          ),
          ...(deliverTo ? { delivery: { destination: deliverTo, addressNote: note } } : {}),
        },
      });
      const invoice = await shopper.call("/api/payments/invoices", {
        method: "POST",
        body: {
          invoiceId: created.id,
          orderId: created.id,
          paymentMethod: payment,
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
      // A QR payment confirms the order by itself, so it is paid first and the staff steps start after it.
      if (paid === "qr") {
        transactionNumber += 1;
        await sePayWebhook(invoice, transactionNumber);
        await untilOrder(shopper, created.id, (order) => order.paymentStatus === "Paid");
      }
      // The pharmacist takes the cash at the counter; a refund is the manager's or the pharmacist's. An order cannot
      // be completed before its cash is recorded, so the cash is taken just before the Completed step (or after the
      // last step when the order is not completed).
      let cashTaken = false;
      const takeCash = async () => {
        if (paid !== "cash" || cashTaken) return;
        cashTaken = true;
        await pharmacist.call(`/api/payments/${invoice.id}/confirm-counter`, {
          method: "POST",
          body: {},
        });
        await untilOrder(shopper, created.id, (order) => order.paymentStatus === "Paid");
      };
      for (const next of steps) {
        if (next === "Completed") await takeCash();
        await manager.call(`/api/orders/${created.id}/transition`, {
          method: "POST",
          body: { status: next },
        });
      }
      await takeCash();
      if (refunded) {
        await manager.call(`/api/payments/${invoice.id}/refund`, {
          method: "POST",
          body: { reason: "Khách đổi ý, hoàn tiền toàn bộ" },
        });
        await untilOrder(shopper, created.id, (order) => order.status === "Cancelled");
      }
    };
    const cash = "cash_on_delivery";
    const qr = "sepay_qr";
    const served = ["Confirmed", "Preparing", "Ready", "Completed"];
    const lan = await signIn({ email: "nguyen.lan@example.com" });
    const khoa = await signIn({ email: "tran.minh.khoa@example.com" });
    const huong = await signIn({ email: "le.thanh.huong@example.com" });
    const viet = await signIn({ email: "pham.quoc.viet@example.com" });
    const mai = await signIn({ email: "vo.ngoc.mai@example.com" });
    const nam = await signIn({ email: "dang.hoang.nam@example.com" });
    // Two addresses in HCMC, inside the delivery range of SITE-RTL.
    const quan3 = { latitude: 10.7769, longitude: 106.7009 };
    const quan7 = { latitude: 10.7295, longitude: 106.7218 };

    // The demo shopper owns one order in every state the customer site draws, oldest first. The newest order that is
    // ready or out for delivery is the one the page features, so the delivery order goes last.
    await place({ shopper: customer, payment: cash, lines: [["THU-0001", 1]], steps: served, paid: "cash" });
    await place({
      shopper: customer,
      payment: qr,
      lines: [
        ["THU-0004", 1],
        ["THU-0031", 1],
      ],
      steps: ["Preparing", "Ready", "Delivering", "Completed"],
      paid: "qr",
      deliverTo: quan3,
      note: "Tầng 3, nhấn chuông căn 302",
    });
    await place({ shopper: customer, payment: cash, lines: [["THU-0025", 1]], steps: ["Cancelled"] });
    await place({ shopper: customer, payment: qr, lines: [["THU-0006", 2]], paid: "qr", refunded: true });
    await place({ shopper: customer, payment: qr, lines: [["THU-0033", 1]] });
    await place({ shopper: customer, payment: qr, lines: [["THU-0001", 3]], paid: "qr" });
    await place({
      shopper: customer,
      payment: cash,
      lines: [
        ["THU-0004", 2],
        ["THU-0031", 1],
        ["THU-0006", 1],
      ],
      steps: ["Confirmed", "Preparing"],
    });
    await place({
      shopper: customer,
      payment: qr,
      lines: [["THU-0034", 1]],
      steps: ["Preparing", "Ready"],
      paid: "qr",
    });
    await place({
      shopper: customer,
      payment: cash,
      lines: [
        ["THU-0025", 1],
        ["THU-0001", 2],
      ],
      steps: ["Confirmed", "Preparing", "Ready", "Delivering"],
      deliverTo: quan7,
      note: "Gọi trước khi đến, cổng sau",
    });

    // The other shoppers hold one state each, so signing in as one of them shows the page with only that state.
    await place({
      shopper: lan,
      payment: qr,
      lines: [
        ["THU-0004", 1],
        ["THU-0006", 1],
      ],
    });
    await place({ shopper: khoa, payment: cash, lines: [["THU-0031", 2]], steps: served, paid: "cash" });
    await place({
      shopper: huong,
      payment: cash,
      lines: [
        ["THU-0033", 1],
        ["THU-0001", 1],
      ],
      steps: ["Confirmed", "Preparing"],
    });
    await place({ shopper: viet, payment: qr, lines: [["THU-0034", 1]], paid: "qr" });
    await place({
      shopper: mai,
      payment: cash,
      lines: [["THU-0006", 2]],
      steps: ["Confirmed", "Preparing", "Ready"],
    });
    await place({ shopper: nam, payment: cash, lines: [["THU-0025", 1]], steps: ["Cancelled"] });
  }
  // Goods receipts: one against the approved purchase order, giving the shop floor stock of two prescription medicines.
  // New batches wait for quality review, so the pharmacist-facing steps below release them first.
  const receiptNumber = "GR-DEMO-001";
  if (!(await existing("/api/procurement/goods-receipts", receiptNumber))) {
    await warehouse.call("/api/procurement/goods-receipts", {
      method: "POST",
      body: {
        receiptNumber,
        supplierId: suppliers.get("SUP-001").id,
        siteId: sites.get("SITE-RTL").id,
        storageLocationId: locations.get("RTL-FRONT").id,
        receivedAt: new Date().toISOString(),
        lines: [
          {
            productId: products.get("THU-0002").id,
            batchNumber: "LOT-2610-101",
            expiryDate: inDays(730),
            quantity: 60,
          },
          {
            productId: products.get("THU-0005").id,
            batchNumber: "LOT-2610-102",
            expiryDate: inDays(745),
            quantity: 40,
          },
        ],
      },
    });
  }
  // A partial delivery against the approved order, which leaves it "partially received".
  if (!(await existing("/api/procurement/goods-receipts", "GR-DEMO-002"))) {
    const order = need(await existing("/api/procurement/purchase-orders", "PO-DEMO-001"), "purchase order PO-DEMO-001");
    await warehouse.call("/api/procurement/goods-receipts", {
      method: "POST",
      body: {
        receiptNumber: "GR-DEMO-002",
        supplierId: suppliers.get("SUP-001").id,
        siteId: sites.get("SITE-RTL").id,
        storageLocationId: locations.get("RTL-FRONT").id,
        purchaseOrderId: order.id,
        receivedAt: new Date().toISOString(),
        lines: [
          {
            productId: products.get("THU-0001").id,
            batchNumber: "LOT-2610-103",
            expiryDate: inDays(760),
            quantity: 200,
          },
        ],
      },
    });
  }
  const reloadBalances = async () => {
    const rows = await admin.call("/api/inventory/balances?limit=500");
    balances.length = 0;
    balances.push(...rows);
  };
  await reloadBalances();
  for (const { balance, batch } of balances) {
    if (batch.batchNumber.startsWith("LOT-2610-") && batch.qualityStatus === "PendingQc") {
      await post(manager, `/api/inventory/batches/${batch.id}/quality`, {
        decision: "release",
        notes: "Đạt kiểm tra nhập kho",
      });
    }
  }
  // Read again after the release, or `stock` would still see the batches as PendingQc.
  await reloadBalances();

  // Replenishment requests from the shop floor: waiting, approved, rejected.
  const replenishments = await admin.call("/api/inventory/replenishment?limit=100", {});
  const replenish = async (note, sku, quantity, action) => {
    if (replenishments.some((row) => row.notes === note)) return;
    const row = stock(sku, "SITE-RTL", "RTL-FRONT");
    const created = await post(pharmacist, "/api/inventory/replenishment", {
      siteId: row.siteId,
      storageLocationId: row.storageLocationId,
      notes: note,
      lines: [
        {
          productId: row.productId,
          productBatchId: row.productBatchId,
          requestedQuantity: quantity,
          reason: "Sắp hết hàng",
        },
      ],
    });
    // Only Warehouse Staff decide.
    if (action) await post(warehouse, `/api/inventory/replenishment/${created.id}/${action}`, { reviewNotes: null });
  };
  await replenish("Kệ trưng bày sắp trống", "THU-0031", 40, undefined);
  await replenish("Chuẩn bị cho đợt khuyến mãi", "THU-0004", 60, "approve");
  await replenish("Đã đủ hàng trên kệ", "THU-0006", 20, "reject");

  // Returns and write-offs.
  const returns = await admin.call("/api/inventory/returns?limit=100");
  const returned = async (reason, sku, quantity) => {
    if (returns.some((row) => row.reason === reason)) return;
    const row = stock(sku, "SITE-RTL", "RTL-FRONT");
    await post(warehouse, "/api/inventory/returns", {
      siteId: row.siteId,
      reason,
      lines: [
        {
          productBatchId: row.productBatchId,
          storageLocationId: row.storageLocationId,
          quantity,
          destination: "Trả nhà cung cấp",
        },
      ],
    });
  };
  await returned("Hộp bị móp khi giao", "THU-0033", 2);
  await returned("Khách trả lại, còn nguyên niêm phong", "THU-0034", 1);

  // Stocktakes: one open and one posted.
  const stocktakes = await admin.call("/api/inventory/stocktakes?limit=100");
  const stocktake = async (note, skus, shouldPost) => {
    if (stocktakes.some((row) => row.notes === note)) return;
    const rows = skus.map((sku) => stock(sku, "SITE-RTL", "RTL-FRONT"));
    const created = await post(warehouse, "/api/inventory/stocktakes", {
      siteId: rows[0].siteId,
      storageLocationId: rows[0].storageLocationId,
      notes: note,
      lines: rows.map((row) => ({ productBatchId: row.productBatchId })),
    });
    if (!shouldPost) return;
    const detail = await admin.call(`/api/inventory/stocktakes/${created.id}`);
    for (const line of detail.lines ?? []) {
      // One unit short on the first line, so the posted count has a variance to show.
      const counted = Number(line.systemQuantity) - (line === detail.lines[0] ? 1 : 0);
      await post(warehouse, `/api/inventory/stocktake-lines/${line.id}/count`, { countedQuantity: counted });
    }
    // Whoever created or counted a stocktake cannot post it, so the manager of the site posts what the warehouse counted.
    await post(manager, `/api/inventory/stocktakes/${created.id}/post`, {});
  };
  await stocktake("Kiểm kê quý 4 - quầy thuốc", ["THU-0031", "THU-0004"], true);
  await stocktake("Kiểm kê đột xuất - kệ vitamin", ["THU-0006"], false);

  // Prescriptions: a queue with one waiting, one dispensed and one cancelled.
  const prescriptions = await admin.call("/api/prescriptions?limit=100");
  const prescribe = async (patientName, sku, quantity, action) => {
    if (prescriptions.some((row) => row.patientName === patientName)) return;
    const row = stock(sku, "SITE-RTL", "RTL-FRONT");
    const units = await admin.call(`/api/products/${row.productId}/units`);
    const unit = need(units.find((entry) => entry.isDefaultSaleUnit) ?? units[0], `a sale unit for ${sku}`);
    const created = await pharmacist.call("/api/prescriptions", {
      method: "POST",
      body: {
        siteId: row.siteId,
        storageLocationId: row.storageLocationId,
        patientName,
        patientPhone: "0901234567",
        doctorName: "BS. Nguyễn Văn An",
        lines: [
          {
            productId: row.productId,
            productUnitId: unit.id,
            prescribedQuantity: quantity,
            dosage: "2 lần mỗi ngày",
            duration: "5 ngày",
          },
        ],
      },
    });
    if (action === "cancel") {
      await pharmacist.call(`/api/prescriptions/${created.id}/cancel`, {
        method: "POST",
        body: {},
      });
    }
    if (action === "dispense") {
      await pharmacist.call(`/api/prescriptions/${created.id}/dispense`, {
        method: "POST",
        body: {
          lines: created.lines.map((line) => ({
            prescriptionLineId: line.id,
            productBatchId: row.productBatchId,
            dispensedQuantity: quantity,
          })),
        },
      });
    }
  };
  await prescribe("Trần Văn Bình", "THU-0002", 10, undefined);
  await prescribe("Lê Thị Cẩm", "THU-0005", 6, "dispense");
  await prescribe("Phạm Quốc Dũng", "THU-0002", 4, "cancel");
  console.log(
    "demo activity: transfers, adjustments, purchase orders, orders, receipts, replenishment, returns, stocktakes and prescriptions are in place",
  );
}
