// Development only. Refuses NODE_ENV=production and any API_BASE_URL that is not a loopback host, so it cannot write
// to a deployed stack.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { datasets, csvRows } from "../apps/staff-web/src/import-datasets.ts";
import { uploadProductImages } from "../apps/catalog-service/scripts/upload-product-images.mjs";

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Set it in your .env file.`);
  return value;
};

if (process.env.NODE_ENV === "production") {
  throw new Error("dev-import-samples is a development tool and refuses to run with NODE_ENV=production.");
}

const baseUrl = new URL(requireEnv("API_BASE_URL"));
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error(`Refusing to import sample data into ${baseUrl.origin}: only a local gateway is allowed.`);
}
const adminEmail = "admin@pharmacycentral.vn";
const pharmacistEmail = "pharmacist@pharmacycentral.vn";
const managerEmail = "manager@pharmacycentral.vn";
const warehouseEmail = "warehouse@pharmacycentral.vn";
const customerEmail = "khachhang@pharmacycentral.vn";
const demoPassword = requireEnv("DEMO_ACCOUNT_PASSWORD");

const cookieHeader = (cookies) => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");

const request = async (cookies, path, { method = "GET", body, headers = {} } = {}) => {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      Cookie: cookieHeader(cookies),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
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

// Each account gets its own cookie jar and CSRF token. `headers` gives the current session headers for a request.
const signIn = async ({ email }) => {
  const cookies = new Map();
  const call = (path, options) => request(cookies, path, options);
  try {
    await call("/api/auth/csrf");
    const account = await call("/api/auth/login", { method: "POST", body: { email, password: demoPassword } });
    return {
      id: account.id,
      call,
      get headers() {
        return { Cookie: cookieHeader(cookies), "X-CSRF-TOKEN": cookies.get("pharmacy_csrf") ?? "" };
      },
    };
  } catch (error) {
    throw new Error(
      `Could not sign in as ${email} through ${baseUrl.origin}. Is the gateway reachable (pnpm run infra:up, and ` +
        `host networking on Docker Desktop) and are the services running (pnpm dev)?\n` +
        String(error instanceof Error ? error.message : error),
      { cause: error },
    );
  }
};

// Which service's internal identity context each dataset is imported under.
const audienceByDataset = Object.freeze({
  sites: "catalog-service",
  storageLocations: "catalog-service",
  suppliers: "catalog-service",
  catalog: "catalog-service",
  openingBalances: "inventory-service",
});

// Local search synonym groups. The admin creates them and the pharmacist approves them, as four-eyes review requires.
const searchSynonymGroups = [
  ["tiêu chảy", "đi ngoài", "đi lỏng"],
  ["sổ mũi", "chảy nước mũi"],
  ["hạ sốt", "giảm sốt"],
  ["đau họng", "rát họng"],
  ["đầy hơi", "chướng bụng"],
  ["ợ chua", "ợ nóng"],
];
// Same folding as foldSearchText in apps/catalog-service search-text.ts, so accent variants count as existing.
const foldSearchTerm = (text) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ|Đ/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
const synonymKey = (terms) => JSON.stringify([...new Set(terms.map(foldSearchTerm))].sort());

const pnpm = process.env.npm_execpath;
// The one place that seeds the demo accounts: the identity-service seed, run through the same pnpm.
const seedArgs = ["--dir", "apps/identity-service", "seed"];
if (!pnpm) throw new Error("Run this through pnpm: pnpm run dev:data");
const seedAccounts = ({ show = false } = {}) => {
  // pnpm 12 ships as a native binary. Older installs set npm_execpath to a .js file that node must run.
  const [command, args] = /\.[cm]?js$/.test(pnpm) ? [process.execPath, [pnpm, ...seedArgs]] : [pnpm, seedArgs];
  const result = spawnSync(command, args, { encoding: "utf8", stdio: show ? "inherit" : "pipe" });
  if (result.status !== 0) {
    throw new Error(
      `seeding the accounts failed (exit ${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
};

console.log("Seeding demo accounts...");
seedAccounts();
console.log("Uploading product images to SeaweedFS...");
const uploadedImageUrls = new Set(
  (await uploadProductImages(fileURLToPath(new URL("../data/product-images/images", import.meta.url)))).map(
    ({ imageUrl }) => imageUrl,
  ),
);

const admin = await signIn({ email: adminEmail });
const { contexts } = await admin.call("/api/auth/context");

const order = ["sites", "storageLocations", "suppliers", "catalog", "openingBalances"];
for (const id of order) {
  const dataset = datasets[id];
  const file = new URL(`../data/import-samples/${dataset.fileBase}.csv`, import.meta.url);
  const payload = dataset.fromCsv(csvRows(await readFile(file, "utf8")));
  if (id === "openingBalances")
    await waitForSearchIndex(
      admin,
      payload.balances.map((row) => row.productSku),
    );
  if (id === "catalog") {
    const missing = payload.products.filter((row) => row.imageUrl && !uploadedImageUrls.has(row.imageUrl));
    if (missing.length > 0) {
      console.warn(
        `Warning: ${missing.length} product(s) point at an image that was not uploaded: ${missing.map((row) => row.sku).join(", ")}`,
      );
    }
  }
  let result;
  try {
    result = await admin.call(dataset.endpoint, {
      method: "POST",
      body: payload,
      headers: { ...admin.headers, "x-internal-identity-context": contexts[audienceByDataset[id]] },
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
console.log("Granting site access to the staff accounts...");
seedAccounts({ show: true });
// After the reseed, so the pharmacist's session carries SITE-RTL access when it approves.
console.log("Seeding search synonyms...");
await seedSearchSynonyms(admin);
console.log("Seeding demo activity (transfers, adjustments, purchase orders, orders)...");
await seedActivity();
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

// Identity contexts expire, so read a fresh catalog-service context for each session before it calls the API.
async function catalogHeaders(session) {
  const { contexts } = await session.call("/api/auth/context");
  return { ...session.headers, "x-internal-identity-context": contexts["catalog-service"] };
}

async function seedSearchSynonyms(admin) {
  const adminHeaders = await catalogHeaders(admin);
  const { items } = await admin.call("/api/products/search-synonyms", { headers: adminHeaders });
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
    const submitted = existing.find((group) => group.submittedBy === admin.id);
    if (submitted) {
      toApprove.push(submitted);
      continue;
    }
    if (existing.length > 0) {
      console.warn(`Search synonym "${terms.join(", ")}" is pending from another employee. Approve it in staff-web.`);
      continue;
    }
    const group = await admin.call("/api/products/search-synonyms", {
      method: "POST",
      body: { terms },
      headers: adminHeaders,
    });
    created += 1;
    toApprove.push(group);
  }

  let approved = 0;
  if (toApprove.length > 0) {
    const pharmacist = await signIn({ email: pharmacistEmail });
    const pharmacistHeaders = await catalogHeaders(pharmacist);
    for (const group of toApprove) {
      await pharmacist.call(`/api/products/search-synonyms/${group.id}/approve`, {
        method: "POST",
        body: { version: group.version },
        headers: pharmacistHeaders,
      });
      approved += 1;
    }
  }
  console.log(`search synonyms: created ${created}, approved ${approved}, already approved ${alreadyApproved}`);
}

// Demo activity, so the list screens have rows in every state. Each record has a fixed number and is skipped when it
// already exists, so running the command again adds nothing. The manager approves what the admin creates, as two
// people must.
async function seedActivity() {
  const manager = await signIn({ email: managerEmail });
  const warehouse = await signIn({ email: warehouseEmail });
  const pharmacist = await signIn({ email: pharmacistEmail });
  const customer = await signIn({ email: customerEmail });
  const withContext = async (session, audience) => {
    const { contexts: fresh } = await session.call("/api/auth/context");
    return { ...session.headers, "x-internal-identity-context": fresh[audience] };
  };
  const inventory = (session) => withContext(session, "inventory-service");

  const sites = new Map(
    (await admin.call("/api/sites?limit=100", { headers: await withContext(admin, "catalog-service") })).map((row) => [
      row.code,
      row,
    ]),
  );
  const catalogHeaders = await withContext(admin, "catalog-service");
  const suppliers = new Map(
    (await admin.call("/api/suppliers?limit=100", { headers: catalogHeaders })).map((row) => [row.code, row]),
  );
  const locations = new Map(
    (await admin.call("/api/storage-locations?limit=100", { headers: catalogHeaders })).map((row) => [row.code, row]),
  );
  const balances = await admin.call("/api/inventory/balances?limit=500", { headers: await inventory(admin) });
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
    const rows = await admin.call(`${path}?q=${encodeURIComponent(number)}&limit=50`, {
      headers: await inventory(admin),
    });
    return rows.find((row) => Object.values(row).includes(number));
  };
  const post = async (session, path, body) =>
    session.call(path, { method: "POST", body, headers: await inventory(session) });

  // Transfers: one waiting for approval, one in transit, one received.
  const transfer = async (number, sku, quantity, steps, fromLocation = "WH-A") => {
    if (await existing("/api/inventory/transfers", number)) return;
    const source = stock(sku, "SITE-WH", fromLocation);
    const created = await post(admin, "/api/inventory/transfers", {
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
    for (const step of steps) await post(manager, `/api/inventory/transfers/${created.id}/${step}`, {});
  };
  await transfer("TR-DEMO-001", "THU-0031", 30, []);
  await transfer("TR-DEMO-002", "THU-0004", 40, ["approve", "ship"]);
  await transfer("TR-DEMO-003", "THU-0006", 25, ["approve", "ship", "receive"], "WH-B");

  // Adjustments: one pending, one approved, one rejected.
  const adjust = async (reason, sku, type, quantity, decision) => {
    const rows = await admin.call("/api/inventory/adjustments?limit=100", { headers: await inventory(admin) });
    if (rows.some((row) => row.reason === reason)) return;
    const row = stock(sku, "SITE-RTL", "RTL-FRONT");
    const created = await post(admin, "/api/inventory/adjustments", {
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
    // The warehouse staff approve orders for their own site.
    const decide = (id) => post(warehouse, `/api/procurement/purchase-orders/${id}/action`, { action });
    const found = await existing("/api/procurement/purchase-orders", number);
    if (found) {
      // An earlier run may have stopped before the decision; deciding twice is refused, which is fine here.
      if (action) await decide(found.id).catch(() => undefined);
      return;
    }
    const created = await post(admin, "/api/procurement/purchase-orders", {
      purchaseOrderNumber: number,
      supplierId: suppliers.get("SUP-001").id,
      siteId: sites.get("SITE-WH").id,
      expectedDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      lines: [{ productId: products.get(sku).id, orderedQuantity: quantity }],
    });
    if (action) await decide(created.id);
  };
  await purchaseOrder("PO-DEMO-001", "THU-0001", 500, "approve");
  await purchaseOrder("PO-DEMO-002", "THU-0025", 200, undefined);
  await purchaseOrder("PO-DEMO-003", "THU-0034", 100, "cancel");

  // Online orders: pickup at the store, one in each of a few states.
  const salesHeaders = async (session) => withContext(session, "sales-service");
  const orders = await admin.call("/api/orders?limit=50", { headers: await salesHeaders(admin) });
  if (orders.length === 0) {
    const unitFor = async (sku) => {
      const units = await admin.call(`/api/products/${products.get(sku).id}/units`, { headers: catalogHeaders });
      return need(units.find((unit) => unit.isDefaultSaleUnit) ?? units[0], `a sale unit for ${sku}`);
    };
    const place = async (sku, quantity, status) => {
      const unit = await unitFor(sku);
      const created = await customer.call("/api/orders", {
        method: "POST",
        body: {
          selectedStoreId: sites.get("SITE-RTL").id,
          fulfillmentType: "pickup",
          paymentMethod: "cash_on_delivery",
          lines: [{ productId: products.get(sku).id, productUnitId: unit.id, quantity }],
        },
        headers: await salesHeaders(customer),
      });
      for (const next of status) {
        await manager.call(`/api/orders/${created.id}/transition`, {
          method: "POST",
          body: { status: next },
          headers: await salesHeaders(manager),
        });
      }
    };
    await place("THU-0001", 2, []);
    await place("THU-0004", 1, ["Confirmed", "Preparing"]);
    await place("THU-0031", 3, ["Confirmed", "Preparing", "Ready"]);
    await place("THU-0006", 2, ["Confirmed", "Preparing", "Ready", "Completed"]);
    await place("THU-0025", 1, ["Cancelled"]);
  }
  // Goods receipts: one against the approved purchase order, giving the shop floor stock of two prescription medicines.
  // New batches wait for quality review, so the pharmacist-facing steps below release them first.
  const receiptNumber = "GR-DEMO-001";
  if (!(await existing("/api/procurement/goods-receipts", receiptNumber))) {
    await admin.call("/api/procurement/goods-receipts", {
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
            expiryDate: "2028-10-01",
            quantity: 60,
          },
          {
            productId: products.get("THU-0005").id,
            batchNumber: "LOT-2610-102",
            expiryDate: "2028-10-15",
            quantity: 40,
          },
        ],
      },
      headers: await inventory(admin),
    });
  }
  // A partial delivery against the approved order, which leaves it "partially received".
  if (!(await existing("/api/procurement/goods-receipts", "GR-DEMO-002"))) {
    const order = need(await existing("/api/procurement/purchase-orders", "PO-DEMO-001"), "purchase order PO-DEMO-001");
    await admin.call("/api/procurement/goods-receipts", {
      method: "POST",
      body: {
        receiptNumber: "GR-DEMO-002",
        supplierId: suppliers.get("SUP-001").id,
        siteId: sites.get("SITE-WH").id,
        storageLocationId: locations.get("WH-A").id,
        purchaseOrderId: order.id,
        receivedAt: new Date().toISOString(),
        lines: [
          {
            productId: products.get("THU-0001").id,
            batchNumber: "LOT-2610-103",
            expiryDate: "2028-10-20",
            quantity: 200,
          },
        ],
      },
      headers: await inventory(admin),
    });
  }
  const refreshed = await admin.call("/api/inventory/balances?limit=500", { headers: await inventory(admin) });
  balances.length = 0;
  balances.push(...refreshed);
  for (const { balance, batch } of balances) {
    if (batch.batchNumber.startsWith("LOT-2610-") && batch.qualityStatus === "PendingQc") {
      await post(manager, `/api/inventory/batches/${batch.id}/quality`, {
        decision: "release",
        notes: "Đạt kiểm tra nhập kho",
      });
    }
  }

  // Replenishment requests from the shop floor: waiting, approved, rejected.
  const replenishments = await admin.call("/api/inventory/replenishment?limit=100", {
    headers: await inventory(admin),
  });
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
    if (action) await post(manager, `/api/inventory/replenishment/${created.id}/${action}`, { reviewNotes: null });
  };
  await replenish("Kệ trưng bày sắp trống", "THU-0031", 40, undefined);
  await replenish("Chuẩn bị cho đợt khuyến mãi", "THU-0004", 60, "approve");
  await replenish("Đã đủ hàng trên kệ", "THU-0006", 20, "reject");

  // Returns and write-offs.
  const returns = await admin.call("/api/inventory/returns?limit=100", { headers: await inventory(admin) });
  const returned = async (reason, sku, quantity) => {
    if (returns.some((row) => row.reason === reason)) return;
    const row = stock(sku, "SITE-RTL", "RTL-FRONT");
    await post(admin, "/api/inventory/returns", {
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
  const stocktakes = await admin.call("/api/inventory/stocktakes?limit=100", { headers: await inventory(admin) });
  const stocktake = async (note, skus, shouldPost) => {
    if (stocktakes.some((row) => row.notes === note)) return;
    const rows = skus.map((sku) => stock(sku, "SITE-RTL", "RTL-FRONT"));
    const created = await post(admin, "/api/inventory/stocktakes", {
      siteId: rows[0].siteId,
      storageLocationId: rows[0].storageLocationId,
      notes: note,
      lines: rows.map((row) => ({ productBatchId: row.productBatchId })),
    });
    if (!shouldPost) return;
    const detail = await admin.call(`/api/inventory/stocktakes/${created.id}`, { headers: await inventory(admin) });
    for (const line of detail.lines ?? []) {
      // One unit short on the first line, so the posted count has a variance to show.
      const counted = Number(line.systemQuantity) - (line === detail.lines[0] ? 1 : 0);
      await post(admin, `/api/inventory/stocktake-lines/${line.id}/count`, { countedQuantity: counted });
    }
    await post(admin, `/api/inventory/stocktakes/${created.id}/post`, {});
  };
  await stocktake("Kiểm kê quý 4 - quầy thuốc", ["THU-0031", "THU-0004"], true);
  await stocktake("Kiểm kê đột xuất - kệ vitamin", ["THU-0006"], false);

  // Prescriptions: a queue with one waiting, one dispensed and one cancelled.
  const salesHeaders2 = await withContext(admin, "sales-service");
  const prescriptions = await admin.call("/api/prescriptions?limit=100", { headers: salesHeaders2 });
  const prescribe = async (patientName, sku, quantity, action) => {
    if (prescriptions.some((row) => row.patientName === patientName)) return;
    const row = stock(sku, "SITE-RTL", "RTL-FRONT");
    const units = await admin.call(`/api/products/${row.productId}/units`, { headers: catalogHeaders });
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
      headers: await withContext(pharmacist, "sales-service"),
    });
    if (action === "cancel") {
      await pharmacist.call(`/api/prescriptions/${created.id}/cancel`, {
        method: "POST",
        body: {},
        headers: await withContext(pharmacist, "sales-service"),
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
        headers: await withContext(pharmacist, "sales-service"),
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
