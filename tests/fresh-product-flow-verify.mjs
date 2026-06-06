#!/usr/bin/env node

process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= "0";

const apiBase = (process.env.PHARMACY_API_BASE_URL ?? "https://localhost:7528/api").replace(/\/$/, "");
const adminEmail = process.env.PHARMACY_ADMIN_EMAIL ?? "admin@pharmacy.local";
const adminPassword = process.env.PHARMACY_ADMIN_PASSWORD ?? "Admin@123!";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

class ApiError extends Error {
  constructor(message, response, body) {
    super(message);
    this.name = "ApiError";
    this.status = response.status;
    this.body = body;
  }
}

class ApiClient {
  #cookie = "";

  constructor(name) {
    this.name = name;
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers ?? {});
    if (this.#cookie) {
      headers.set("Cookie", this.#cookie);
    }

    const response = await fetch(`${apiBase}/${path.replace(/^\//, "")}`, {
      ...options,
      headers,
    });

    this.#captureCookie(response);
    return response;
  }

  async get(path, expectedStatus = 200) {
    const response = await this.request(path);
    return await readExpected(response, expectedStatus, `${this.name} GET ${path}`);
  }

  async post(path, body, expectedStatus = 200, extraHeaders = {}) {
    const token = await this.csrf();
    const response = await this.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": token,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    return await readExpected(response, expectedStatus, `${this.name} POST ${path}`);
  }

  async csrf() {
    const response = await this.request("auth/csrf");
    const payload = await readExpected(response, 200, `${this.name} CSRF`);
    assert(payload.token, `${this.name} CSRF response should include token`);
    return payload.token;
  }

  async login(email, password) {
    const payload = await this.post("auth/login", { email, password, rememberMe: false }, 200);
    assert(payload.email?.toLowerCase() === email.toLowerCase(), `${this.name} login should return ${email}`);
    return payload;
  }

  #captureCookie(response) {
    const raw = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie")?.split(/,(?=\s*[^;]+=)/g) ?? [];

    if (!raw || raw.length === 0) {
      return;
    }

    const jar = new Map(
      this.#cookie
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const index = part.indexOf("=");
          return [part.slice(0, index), part.slice(index + 1)];
        }),
    );

    for (const item of raw) {
      const cookiePair = item.split(";", 1)[0];
      const index = cookiePair.indexOf("=");
      if (index > 0) {
        jar.set(cookiePair.slice(0, index).trim(), cookiePair.slice(index + 1).trim());
      }
    }

    this.#cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

async function readExpected(response, expectedStatus, label) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (response.status !== expectedStatus) {
    throw new ApiError(`${label} expected HTTP ${expectedStatus}, got ${response.status}`, response, body);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertApprox(actual, expected, message) {
  if (Math.abs(Number(actual) - Number(expected)) > 0.0001) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function findBalance(balances, batchId, locationId) {
  return balances.find((item) => item.productBatchId === batchId && item.storageLocationId === locationId);
}

async function createUser(admin, email, password, displayName, roles, siteIds) {
  return await admin.post("admin/users", {
    email,
    password,
    displayName,
    roles,
    siteIds,
  }, 201);
}

async function main() {
  console.log(`Running fresh product flow verification against ${apiBase}`);

  const admin = new ApiClient("admin");
  const manager = new ApiClient("manager");
  const warehouse = new ApiClient("warehouse");
  const pharmacist = new ApiClient("pharmacist");

  await admin.get("health", 200).catch(async () => {
    const response = await fetch(`${apiBase.replace(/\/api$/, "")}/health`);
    assertEqual(response.status, 200, "API health endpoint should be healthy");
  });

  await admin.login(adminEmail, adminPassword);
  const adminMe = await admin.get("auth/me");
  assert(adminMe.isPlatformAdmin === true, "Bootstrap admin should be Platform Admin");
  console.log("PASS bootstrap admin login");

  const initialProducts = await admin.get("products");
  const initialSuppliers = await admin.get("suppliers");
  if (process.env.PHARMACY_EXPECT_NO_BUSINESS_SEED === "true") {
    assertEqual(initialProducts.length, 0, "Fresh no-business-seed database should start with no products");
    assertEqual(initialSuppliers.length, 0, "Fresh no-business-seed database should start with no suppliers");
  }
  console.log("PASS optional no-business-seed baseline check");

  const warehouseSite = await admin.post("sites", {
    code: `WH-FRESH-${suffix}`.slice(0, 50),
    name: `Kho kiểm thử ${suffix}`,
    siteType: "Warehouse",
    status: "Active",
    address: "Fresh flow warehouse",
    notes: "Created by fresh flow verification.",
    isActive: true,
  }, 201);

  const storeSite = await admin.post("sites", {
    code: `ST-FRESH-${suffix}`.slice(0, 50),
    name: `Nhà thuốc kiểm thử ${suffix}`,
    siteType: "RetailStore",
    status: "Active",
    address: "Fresh flow store",
    notes: "Created by fresh flow verification.",
    isActive: true,
  }, 201);

  const warehouseLocation = await admin.post("storage-locations", {
    siteId: warehouseSite.id,
    code: `WHLOC-${suffix}`.slice(0, 50),
    name: "Khu lưu trữ kiểm thử",
    locationType: "Storage",
    status: "Active",
    capacity: 1000,
    isActive: true,
  }, 201);

  const storeLocation = await admin.post("storage-locations", {
    siteId: storeSite.id,
    code: `STLOC-${suffix}`.slice(0, 50),
    name: "Kho nhà thuốc kiểm thử",
    locationType: "Storage",
    status: "Active",
    capacity: 500,
    isActive: true,
  }, 201);
  console.log("PASS admin creates first sites and storage locations");

  const password = "Fresh@123!";
  const managerEmail = `fresh-manager-${suffix}@pharmacy.local`;
  const warehouseEmail = `fresh-warehouse-${suffix}@pharmacy.local`;
  const pharmacistEmail = `fresh-pharmacist-${suffix}@pharmacy.local`;

  await createUser(admin, managerEmail, password, "Fresh flow manager", ["Pharmacy Manager"], [warehouseSite.id, storeSite.id]);
  await createUser(admin, warehouseEmail, password, "Fresh flow warehouse", ["Warehouse Staff"], [warehouseSite.id, storeSite.id]);
  await createUser(admin, pharmacistEmail, password, "Fresh flow pharmacist", ["Pharmacist"], [storeSite.id]);
  console.log("PASS admin creates role-specific users");

  await manager.login(managerEmail, password);
  await warehouse.login(warehouseEmail, password);
  await pharmacist.login(pharmacistEmail, password);

  await manager.get("admin/users", 403);
  await pharmacist.get(`purchase-orders?siteId=${warehouseSite.id}`, 403);
  await warehouse.post("products", { sku: "BLOCKED", name: "Blocked", category: "Blocked", unit: "box", manufacturer: "Blocked", status: "Active", isActive: true }, 403);
  await pharmacist.get(`dashboard/summary?siteId=${warehouseSite.id}`, 403);
  await pharmacist.get(`dashboard/summary?siteId=${storeSite.id}`, 200);
  console.log("PASS role and site boundaries for created users");

  const product = await manager.post("products", {
    sku: `FRESH-${suffix}`.slice(0, 50),
    name: `Thuốc kiểm thử ${suffix}`,
    category: "Kiểm thử",
    unit: "hộp",
    manufacturer: "Nhà sản xuất kiểm thử",
    status: "Active",
    notes: "Created by fresh flow verification.",
    isActive: true,
  }, 201);

  const supplier = await manager.post("suppliers", {
    code: `SUP-FR-${suffix}`.slice(0, 50),
    name: `Nhà cung cấp kiểm thử ${suffix}`,
    contactName: "Fresh verifier",
    email: `fresh-supplier-${suffix}@pharmacy.local`,
    phone: "0900000000",
    address: "Fresh verification address",
    status: "Active",
    notes: "Created by fresh flow verification.",
    isActive: true,
  }, 201);

  const draftPrice = await manager.post("pricing/prices", {
    productId: product.id,
    siteId: storeSite.id,
    unitPrice: 25000,
    currency: "VND",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: null,
    notes: "Fresh flow price.",
  }, 201);
  await manager.post(`pricing/prices/${draftPrice.id}/publish`, {}, 200);
  console.log("PASS manager creates catalog, supplier, and published price");

  const purchaseOrder = await manager.post("purchase-orders", {
    purchaseOrderNumber: `PO-FR-${suffix}`.slice(0, 100),
    supplierId: supplier.id,
    siteId: warehouseSite.id,
    expectedDate: "2031-01-15",
    notes: "Fresh flow purchase order.",
    lines: [{ productId: product.id, orderedQuantity: 20, notes: "Initial order." }],
  }, 201);
  await manager.post(`purchase-orders/${purchaseOrder.id}/approve`, {}, 200);
  console.log("PASS manager creates and approves purchase order");

  const receipt = await warehouse.post("goods-receipts", {
    supplierId: supplier.id,
    siteId: warehouseSite.id,
    storageLocationId: warehouseLocation.id,
    purchaseOrderId: purchaseOrder.id,
    receiptNumber: `GR-FR-${suffix}`.slice(0, 100),
    notes: "Fresh flow receipt.",
    lines: [{
      productId: product.id,
      batchNumber: `B-FR-${suffix}`.slice(0, 100),
      expiryDate: "2031-12-31",
      manufacturedDate: "2026-01-01",
      manufacturer: "Nhà sản xuất kiểm thử",
      quantity: 20,
      notes: "Initial fresh stock.",
    }],
  }, 201);
  const batchId = receipt.lines[0].productBatchId;
  assert(batchId, "Receipt should create product batch");
  assertEqual(receipt.lines[0].qualityStatus, "PendingQc", "Received batch should wait for quality review");
  await warehouse.post("inventory/fefo-allocate", { productId: product.id, siteId: warehouseSite.id, quantityNeeded: 1 }, 400);
  await warehouse.post(`quality/batches/${batchId}/release`, { notes: "Fresh flow release." }, 200);
  console.log("PASS warehouse receives stock and releases quality hold");

  const transfer = await warehouse.post("transfers", {
    sourceSiteId: warehouseSite.id,
    sourceStorageLocationId: warehouseLocation.id,
    destinationSiteId: storeSite.id,
    destinationStorageLocationId: storeLocation.id,
    notes: "Fresh flow transfer to store.",
    lines: [{ productId: product.id, productBatchId: batchId, requestedQuantity: 8, notes: "Store replenishment." }],
  }, 201);
  await warehouse.post(`transfers/${transfer.id}/approve`, {}, 400);
  await admin.post(`transfers/${transfer.id}/approve`, {}, 200);
  await warehouse.post(`transfers/${transfer.id}/ship`, {
    lines: [{ transferOrderLineId: transfer.lines[0].id, shippedQuantity: 8 }],
  }, 200);
  await warehouse.post(`transfers/${transfer.id}/receive`, {
    lines: [{ transferOrderLineId: transfer.lines[0].id, receivedQuantity: 8 }],
  }, 200);
  console.log("PASS warehouse transfer lifecycle with second-user approval");

  const prescriptionPayload = {
    siteId: storeSite.id,
    storageLocationId: storeLocation.id,
    patientName: `Bệnh nhân kiểm thử ${suffix}`,
    patientPhone: "0900000001",
    doctorName: "Bác sĩ kiểm thử",
    doctorLicense: "FRESH",
    notes: "Fresh flow prescription.",
    lines: [{
      productId: product.id,
      prescribedQuantity: 2,
      dosage: "1 hộp",
      frequency: "Hằng ngày",
      duration: "2 ngày",
      notes: "Fresh dispense line.",
    }],
  };
  const prescription = await pharmacist.post("prescriptions", prescriptionPayload, 201, { "Idempotency-Key": `fresh-rx-${suffix}` });
  const dispensed = await pharmacist.post(`prescriptions/${prescription.id}/dispense`, {
    lines: [{ prescriptionLineId: prescription.lines[0].id, productBatchId: batchId, dispensedQuantity: 2 }],
  }, 200, { "Idempotency-Key": `fresh-dispense-${suffix}` });
  assert(["Dispensed", "PartiallyDispensed"].includes(dispensed.status), "Prescription should dispense");
  console.log("PASS pharmacist creates and dispenses prescription");

  const returned = await pharmacist.post("returns", {
    productId: product.id,
    productBatchId: batchId,
    siteId: storeSite.id,
    storageLocationId: storeLocation.id,
    quantity: 1,
    reason: "Damaged",
    destination: "Fresh flow disposal",
    notes: "Fresh flow return/removal.",
  }, 201);
  assertApprox(returned.quantityDelta, -1, "Return should decrease stock");
  console.log("PASS pharmacist records return/removal");

  const balances = await admin.get(`inventory/balances?productId=${product.id}&includeZeroBalances=true`);
  const warehouseBalance = findBalance(balances, batchId, warehouseLocation.id);
  const storeBalance = findBalance(balances, batchId, storeLocation.id);
  assertApprox(warehouseBalance.quantityOnHand, 12, "Warehouse stock should reflect transfer out");
  assertApprox(storeBalance.quantityOnHand, 5, "Store stock should reflect transfer in, dispense, and return");
  assertApprox(storeBalance.quantityReserved, 0, "Dispensing should consume held stock");
  console.log("PASS final stock position matches ordered flow");

  const dashboard = await admin.get(`dashboard/summary?siteId=${storeSite.id}`);
  assert(typeof dashboard.totalQuantityOnHand === "number", "Dashboard should return numeric totals");
  const finance = await manager.get(`finance/summary?siteId=${storeSite.id}`);
  assert(finance.inventoryValue >= 0, "Finance summary should load for manager");
  const audit = await admin.get(`audit/logs?limit=50`);
  assert(audit.length > 0, "Audit should include business activity");
  console.log("PASS admin/manager visibility: dashboard, finance, audit");

  console.log("NOTE invoice/payment capture is not implemented in the current API; finance is read-only reconciliation visibility.");
  console.log("All fresh product flow verification checks passed.");
}

main().catch((error) => {
  if (error instanceof ApiError) {
    console.error(error.message);
    console.error(JSON.stringify(error.body, null, 2));
  } else {
    console.error(error.stack ?? error.message ?? String(error));
  }
  process.exit(1);
});
