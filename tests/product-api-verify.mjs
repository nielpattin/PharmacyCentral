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

  async post(path, body, expectedStatus = 200) {
    const token = await this.csrf();
    const response = await this.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": token,
      },
      body: JSON.stringify(body),
    });
    return await readExpected(response, expectedStatus, `${this.name} POST ${path}`);
  }

  async put(path, body, expectedStatus = 200) {
    const token = await this.csrf();
    const response = await this.request(path, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": token,
      },
      body: JSON.stringify(body),
    });
    return await readExpected(response, expectedStatus, `${this.name} PUT ${path}`);
  }

  async csrf() {
    const response = await this.request("auth/csrf");
    const payload = await readExpected(response, 200, `${this.name} CSRF`);
    assert(payload.token, `${this.name} CSRF response should include token`);
    return payload.token;
  }

  async login(email, password) {
    const payload = await this.post("auth/login", { email, password, rememberMe: false }, 200);
    assert(payload.email?.toLowerCase() === email.toLowerCase(), `${this.name} login should return the expected user`);
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

function pickStorageForSite(storageLocations, siteId) {
  const location = storageLocations.find((item) => item.siteId === siteId && item.isActive !== false);
  assert(location, `Expected an active storage location for site ${siteId}`);
  return location;
}

function balanceFor(balances, productBatchId, storageLocationId) {
  return balances.find((item) => item.productBatchId === productBatchId && item.storageLocationId === storageLocationId);
}

async function createUser(admin, email, password, roles, siteIds) {
  return await admin.post("admin/users", {
    email,
    password,
    displayName: `Product verifier ${email}`,
    roles,
    siteIds,
  }, 201);
}

async function main() {
  console.log(`Running product API verification against ${apiBase}`);

  const admin = new ApiClient("admin");
  const limited = new ApiClient("limited");
  const approver = new ApiClient("approver");
  const noRole = new ApiClient("no-role");

  await admin.get("health", 200).catch(async () => {
    const response = await fetch(`${apiBase.replace(/\/api$/, "")}/health`);
    assertEqual(response.status, 200, "API health endpoint should be healthy");
  });

  await admin.login(adminEmail, adminPassword);
  const adminMe = await admin.get("auth/me");
  assert(adminMe.isPlatformAdmin === true, "Seeded admin should be Platform Admin");
  console.log("PASS auth login and current-user contract");

  const badLogin = new ApiClient("bad-login");
  await badLogin.post("auth/login", { email: adminEmail, password: "Wrong@123!", rememberMe: false }, 401);
  console.log("PASS bad login is rejected");

  const sites = await admin.get("sites");
  assert(sites.length >= 2, "Verification requires at least two seeded sites");
  const storageLocations = await admin.get("storage-locations");
  const sourceSite = sites[0];
  const destinationSite = sites.find((site) => site.id !== sourceSite.id) ?? sites[1];
  const sourceLocation = pickStorageForSite(storageLocations, sourceSite.id);
  const destinationLocation = pickStorageForSite(storageLocations, destinationSite.id);

  const limitedEmail = `product-limited-${suffix}@pharmacy.local`;
  const approverEmail = `product-approver-${suffix}@pharmacy.local`;
  const noRoleEmail = `product-norole-${suffix}@pharmacy.local`;
  const password = "Product@123!";

  await createUser(admin, limitedEmail, password, ["Pharmacy Manager", "Warehouse Staff"], [sourceSite.id]);
  await createUser(admin, approverEmail, password, ["Warehouse Staff"], [sourceSite.id, destinationSite.id]);
  await noRole.post("auth/register", { email: noRoleEmail, password, displayName: "No role verifier" }, 201);

  await limited.login(limitedEmail, password);
  await approver.login(approverEmail, password);
  await noRole.login(noRoleEmail, password);

  const limitedMe = await limited.get("auth/me");
  assertEqual(limitedMe.siteIds.length, 1, "Limited verifier should have exactly one assigned site");
  assertEqual(limitedMe.siteIds[0], sourceSite.id, "Limited verifier should be scoped to source site");

  await noRole.get("inventory/balances", 403);
  await limited.get(`dashboard/summary?siteId=${sourceSite.id}`, 200);
  await limited.get(`dashboard/summary?siteId=${destinationSite.id}`, 403);
  const limitedSites = await limited.get("sites");
  assertEqual(limitedSites.length, 1, "Limited verifier should see only assigned sites");
  assertEqual(limitedSites[0].id, sourceSite.id, "Limited verifier sites list should contain only source site");
  console.log("PASS RBAC and assigned-site boundaries");

  const product = await admin.post("products", {
    sku: `E2E-${suffix}`.slice(0, 50),
    name: `Product verification ${suffix}`,
    category: "Verification",
    unit: "box",
    manufacturer: "Verification manufacturer",
    status: "Active",
    notes: "Created by product API verification.",
    isActive: true,
  }, 201);

  const supplier = await admin.post("suppliers", {
    code: `SUP-${suffix}`.slice(0, 50),
    name: `Supplier verification ${suffix}`,
    contactName: "Verifier",
    email: `supplier-${suffix}@pharmacy.local`,
    phone: "0900000000",
    address: "Verification address",
    status: "Active",
    notes: "Created by product API verification.",
    isActive: true,
  }, 201);

  const receipt = await admin.post("goods-receipts", {
    supplierId: supplier.id,
    siteId: sourceSite.id,
    storageLocationId: sourceLocation.id,
    receiptNumber: `GR-${suffix}`.slice(0, 100),
    notes: "Product verification receipt.",
    lines: [{
      productId: product.id,
      batchNumber: `B-${suffix}`.slice(0, 100),
      expiryDate: "2031-12-31",
      manufacturedDate: "2026-01-01",
      manufacturer: "Verification manufacturer",
      quantity: 50,
      notes: "Initial verification stock.",
    }],
  }, 201);

  const productBatchId = receipt.lines[0].productBatchId;
  assert(productBatchId, "Goods receipt should create or resolve a product batch");
  const balancesAfterReceipt = await admin.get(`inventory/balances?productId=${product.id}&siteId=${sourceSite.id}&includeZeroBalances=true`);
  const sourceBalanceAfterReceipt = balanceFor(balancesAfterReceipt, productBatchId, sourceLocation.id);
  assert(sourceBalanceAfterReceipt, "Receipt should create inventory balance at source location");
  assertApprox(sourceBalanceAfterReceipt.quantityOnHand, 50, "Receipt should increase source balance");
  const receiptLedger = await admin.get(`inventory/ledger?productBatchId=${productBatchId}&siteId=${sourceSite.id}&limit=20`);
  assert(receiptLedger.some((entry) => entry.referenceType === "GoodsReceipt" && Number(entry.quantityDelta) === 50), "Receipt should be visible in inventory history");
  console.log("PASS receiving creates batch, balance, and history");

  const fefo = await admin.post("inventory/fefo-allocate", {
    productId: product.id,
    siteId: sourceSite.id,
    quantityNeeded: 5,
  });
  assert(Array.isArray(fefo.allocations) || Array.isArray(fefo.lines), "FEFO response should include allocation details");
  await admin.post("inventory/fefo-allocate", {
    productId: product.id,
    siteId: sourceSite.id,
    quantityNeeded: 5000,
  }, 400);
  console.log("PASS FEFO allocation and insufficient-stock guard");

  const prescription = await admin.post("prescriptions", {
    siteId: sourceSite.id,
    storageLocationId: sourceLocation.id,
    patientName: `Patient ${suffix}`,
    patientPhone: "0900000001",
    doctorName: "Doctor verifier",
    doctorLicense: "VERIFIER",
    notes: "Product verification prescription.",
    lines: [{
      productId: product.id,
      prescribedQuantity: 5,
      dosage: "1 box",
      frequency: "Daily",
      duration: "5 days",
      notes: "Verification dispense line.",
    }],
  }, 201);
  const dispensed = await admin.post(`prescriptions/${prescription.id}/dispense`, {
    lines: [{
      prescriptionLineId: prescription.lines[0].id,
      productBatchId,
      dispensedQuantity: 5,
    }],
  });
  assert(["Dispensed", "PartiallyDispensed"].includes(dispensed.status), "Prescription should be dispensed or partially dispensed");
  let balances = await admin.get(`inventory/balances?productId=${product.id}&siteId=${sourceSite.id}&includeZeroBalances=true`);
  assertApprox(balanceFor(balances, productBatchId, sourceLocation.id).quantityOnHand, 45, "Dispense should decrease source balance");
  console.log("PASS prescription and dispensing lifecycle");

  const transfer = await admin.post("transfers", {
    sourceSiteId: sourceSite.id,
    sourceStorageLocationId: sourceLocation.id,
    destinationSiteId: destinationSite.id,
    destinationStorageLocationId: destinationLocation.id,
    notes: "Product verification transfer.",
    lines: [{
      productId: product.id,
      productBatchId,
      requestedQuantity: 4,
      notes: "Verification transfer line.",
    }],
  }, 201);
  await admin.post(`transfers/${transfer.id}/approve`, {}, 400);
  const approved = await approver.post(`transfers/${transfer.id}/approve`, {});
  assertEqual(approved.status, "Approved", "Second user should approve transfer");
  const shipped = await admin.post(`transfers/${transfer.id}/ship`, {
    lines: [{ transferOrderLineId: transfer.lines[0].id, shippedQuantity: 4 }],
  });
  assertEqual(shipped.status, "InTransit", "Transfer should move to in transit after ship");
  const received = await admin.post(`transfers/${transfer.id}/receive`, {
    lines: [{ transferOrderLineId: transfer.lines[0].id, receivedQuantity: 4 }],
  });
  assertEqual(received.status, "Received", "Transfer should be received");
  balances = await admin.get(`inventory/balances?productId=${product.id}&includeZeroBalances=true`);
  assertApprox(balanceFor(balances, productBatchId, sourceLocation.id).quantityOnHand, 41, "Transfer should decrease source balance");
  assertApprox(balanceFor(balances, productBatchId, destinationLocation.id).quantityOnHand, 4, "Transfer should increase destination balance");
  console.log("PASS transfer lifecycle with second-user approval");

  const returned = await admin.post("returns", {
    productId: product.id,
    productBatchId,
    siteId: sourceSite.id,
    storageLocationId: sourceLocation.id,
    quantity: 1,
    reason: "Damaged",
    destination: "Verification disposal",
    notes: "Product verification return.",
  }, 201);
  assertApprox(returned.quantityDelta, -1, "Return should create a negative stock change");
  balances = await admin.get(`inventory/balances?productId=${product.id}&siteId=${sourceSite.id}&includeZeroBalances=true`);
  assertApprox(balanceFor(balances, productBatchId, sourceLocation.id).quantityOnHand, 40, "Return should decrease source balance");
  console.log("PASS return/removal workflow");

  const stocktake = await admin.post("stocktake-sessions", {
    siteId: sourceSite.id,
    storageLocationId: sourceLocation.id,
    notes: "Product verification stocktake.",
  }, 201);
  const counted = await admin.post(`stocktake-sessions/${stocktake.id}/counts`, {
    countSheetLines: [{
      productId: product.id,
      productBatchId,
      countedQuantity: 42,
      notes: "Verification count variance.",
    }],
  });
  assert(counted.countSheetLines.some((line) => line.productBatchId === productBatchId && Number(line.variance) === 2), "Stocktake count should capture variance");
  const postedAdjustments = await admin.post(`stocktake-sessions/${stocktake.id}/adjustments`, {});
  assert(postedAdjustments.some((item) => item.productBatchId === productBatchId && item.status === "Approved"), "Stocktake adjustment should be approved when posted");
  balances = await admin.get(`inventory/balances?productId=${product.id}&siteId=${sourceSite.id}&includeZeroBalances=true`);
  assertApprox(balanceFor(balances, productBatchId, sourceLocation.id).quantityOnHand, 42, "Stocktake adjustment should update balance");
  console.log("PASS stocktake count and adjustment posting");

  const pendingAdjustment = await admin.post("stock-adjustments", {
    productId: product.id,
    productBatchId,
    siteId: sourceSite.id,
    storageLocationId: sourceLocation.id,
    adjustmentType: "Positive",
    quantity: 1,
    reason: "OperationalCorrection",
    notes: "Product verification standalone adjustment.",
  }, 201);
  assertEqual(pendingAdjustment.status, "Pending", "Standalone adjustment should start pending");
  await admin.post(`stock-adjustments/${pendingAdjustment.id}/approve`, { approvalNotes: "Self approval should fail." }, 400);
  const approvedAdjustment = await approver.post(`stock-adjustments/${pendingAdjustment.id}/approve`, { approvalNotes: "Verified by product test." });
  assertEqual(approvedAdjustment.status, "Approved", "Second user should approve standalone adjustment");
  balances = await admin.get(`inventory/balances?productId=${product.id}&siteId=${sourceSite.id}&includeZeroBalances=true`);
  assertApprox(balanceFor(balances, productBatchId, sourceLocation.id).quantityOnHand, 43, "Standalone adjustment approval should update balance");
  console.log("PASS standalone stock adjustment approval");

  const dashboard = await admin.get(`dashboard/summary?siteId=${sourceSite.id}`);
  assert(typeof dashboard.totalQuantityOnHand === "number", "Dashboard summary should include quantity totals");
  const limitedBalances = await limited.get("inventory/balances");
  assert(limitedBalances.every((item) => item.siteId === sourceSite.id), "Limited inventory list should not leak other sites");
  console.log("PASS dashboard and reporting data sanity");

  console.log("All product API verification checks passed.");
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
