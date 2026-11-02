// Admin import journey: the products import and the opening-balance import, 20 rows each, under SKUs and batch numbers
// unique to the run (K6-IMP-<run id>-<n>). Checks the import counts, a re-run of the same file, a bad row, and that the
// imported stock reaches availability within a bounded wait. Contracts: apps/catalog-service/src/contracts/imports.ts,
// apps/inventory-service/src/contracts/imports.ts and the import services. Row shapes follow
// apps/staff-web/src/import-datasets.ts.
//
// Both imports are all-or-nothing: one invalid row rejects the whole payload with 400 invalid_import and a row-level
// `errors[].path` (e.g. `products.7.name`), and nothing is applied. Re-running the same opening-balance file answers
// `unchanged` for every row. Re-running the same product file upserts by SKU.
//
// Products reach the search index asynchronously, and inventory resolves each balance row's SKU through that search, so
// the balance import waits until every new SKU is searchable (seed-demo.mjs does the same).
//
// Accounts follow the role rules: product imports are the Pharmacy Manager's (catalog ROLE_RULES.pharmacyManager) and
// opening balances are Warehouse Staff's (inventory ROLE_RULES). Platform Admin reads
// everything but is refused both writes with 403, so the manager does the catalog work and reads, and warehouse posts
// the balances. Both are demo accounts that take DEMO_ACCOUNT_PASSWORD.
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

import { accounts, profile } from "../lib/config.js";
import { login, loginOncePerVu } from "../lib/session.js";

const productImportMs = new Trend("product_import_ms", true);
const searchableMs = new Trend("product_searchable_ms", true);
const openingBalanceImportMs = new Trend("opening_balance_import_ms", true);
const availabilityCatchUpMs = new Trend("availability_catch_up_ms", true);
const businessRejections = new Counter("business_rejections");

const ROWS = 20;
const INVALID_ROW = 7;
const SEARCH_WAIT_S = 60;
const AVAILABILITY_WAIT_S = 60;
const PRICE_EFFECTIVE_FROM = "2025-01-01";
const EXPIRY_DATE = "2028-12-31";
const QUANTITY_ON_HAND = 25;

// One iteration imports 2 x 20 products and 2 x 20 balances, so iterations x VUs stay small.
const PLANS = {
  smoke: { vus: 1, iterations: 1 },
  load: { vus: 2, iterations: 4 },
  stress: { vus: 4, iterations: 8 },
};
const plan = PLANS[profile()];

export const options = {
  scenarios: {
    imports: {
      executor: "shared-iterations",
      vus: plan.vus,
      iterations: plan.iterations,
      maxDuration: "10m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    product_import_ms: ["p(95)<5000"],
    product_searchable_ms: [`p(95)<${SEARCH_WAIT_S * 1000}`],
    // Inventory resolves each row's SKU with its own catalog search, so the balance import is slow at 20 rows.
    opening_balance_import_ms: ["p(95)<10000"],
    availability_catch_up_ms: [`p(95)<${AVAILABILITY_WAIT_S * 1000}`],
  },
};

// The first customer-facing store and one of its storage locations, where the opening stock lands.
export function setup() {
  const manager = login(accounts.manager);
  const stores = manager.get("/api/stores", { query: { limit: 50 }, name: "GET /stores" }).json();
  if (!Array.isArray(stores) || stores.length === 0) throw new Error("No customer-facing store to stock");
  const store = stores[0];
  const locations = manager
    .get("/api/storage-locations", { query: { siteId: store.id }, name: "GET /storage-locations" })
    .json()
    .filter((location) => location.siteId === store.id);
  if (locations.length === 0) throw new Error(`Store ${store.code} has no storage location`);
  return {
    runId: Date.now().toString(36).toUpperCase(),
    siteId: store.id,
    storageLocationId: locations[0].id,
  };
}

const pad = (n) => String(n).padStart(2, "0");

function skusFor(run, tag = "") {
  return Array.from({ length: ROWS }, (_, index) => `K6-IMP-${run}-${tag}${pad(index + 1)}`);
}

function productPayload(skus, invalidIndex = -1) {
  return {
    schemaVersion: 1,
    products: skus.map((sku, index) => ({
      sku,
      name: index === invalidIndex ? "" : `K6 import test product ${pad(index + 1)}`,
      genericName: "K6 import test",
      activeIngredient: "K6 import test",
      strength: "500mg",
      dosageForm: "Viên nén",
      packageDescription: "K6 import test pack",
      category: "K6 import test",
      manufacturer: "K6 Test Pharma",
      status: "Active",
      prescriptionRequired: false,
      isActive: true,
      units: [
        {
          unitName: "Viên",
          conversionFactorToBaseUnit: 1,
          isBaseUnit: true,
          isDefaultSaleUnit: true,
          isDefaultPurchaseUnit: true,
          sortOrder: 0,
        },
      ],
      price: { unitPrice: 1000 + index, currency: "VND", status: "Published", effectiveFrom: PRICE_EFFECTIVE_FROM },
    })),
  };
}

function balancePayload(skus, siteId, storageLocationId, batchTag, invalidIndex = -1) {
  return {
    schemaVersion: 1,
    balances: skus.map((sku, index) => ({
      productSku: sku,
      siteId,
      storageLocationId,
      batchNumber: `K6-IMP-${batchTag}-B${pad(index + 1)}`,
      quantityOnHand: index === invalidIndex ? -5 : QUANTITY_ON_HAND,
      expiryDate: EXPIRY_DATE,
      manufacturer: "K6 Test Pharma",
      qualityStatus: "Released",
      reason: `k6 import ${batchTag}`,
    })),
  };
}

// Catalog rows per SKU, from one search per SKU, keeping only the exact SKU searched for. Empty lists mean the SKU is
// not searchable yet.
function lookupSkus(manager, skus) {
  const found = new Map(skus.map((sku) => [sku, []]));
  for (const sku of skus) {
    const rows = manager
      .get("/api/products", { query: { search: sku, limit: 100 }, name: "GET /products (sku lookup)" })
      .json();
    if (Array.isArray(rows)) found.get(sku).push(...rows.filter((row) => row.sku === sku));
  }
  return found;
}

function awaitSearchable(manager, skus) {
  const started = Date.now();
  for (;;) {
    const found = lookupSkus(manager, skus);
    if (skus.every((sku) => found.get(sku).length >= 1)) return { elapsedMs: Date.now() - started, found };
    if (Date.now() - started >= SEARCH_WAIT_S * 1000) return { elapsedMs: undefined, found };
    sleep(2);
  }
}

function waitForAvailability(manager, siteId, productIds) {
  const started = Date.now();
  for (;;) {
    const rows = manager.get("/api/availability", { query: { siteId }, name: "GET /availability" }).json();
    const inStock = new Set(Array.isArray(rows) ? rows.filter((row) => row.inStock).map((row) => row.productId) : []);
    if (productIds.every((id) => inStock.has(id))) return Date.now() - started;
    if (Date.now() - started >= AVAILABILITY_WAIT_S * 1000) return undefined;
    sleep(1);
  }
}

export default function (data) {
  const manager = loginOncePerVu(accounts.manager);
  const warehouse = loginOncePerVu(accounts.warehouse);
  // Unique per VU and iteration, so iterations of a load run never reuse a SKU or batch number.
  const run = `${data.runId}-${__VU}-${__ITER}`;
  const skus = skusFor(run);

  // Products: import, wait until they are searchable, then re-run the same file.
  const productFirst = manager.post("/api/products/imports", productPayload(skus), { name: "POST /products/imports" });
  productImportMs.add(productFirst.timings.duration);
  check(productFirst, {
    "product import accepted (200)": (r) => r.status === 200 && r.json()?.status === "imported",
    "product import counts 20 products, 20 units and 20 prices": (r) => {
      const summary = r.json()?.summary;
      return summary?.products === ROWS && summary?.productUnits === ROWS && summary?.prices === ROWS;
    },
  });

  const searchable = awaitSearchable(manager, skus);
  if (searchable.elapsedMs !== undefined) searchableMs.add(searchable.elapsedMs);
  check(
    { searchable: searchable.elapsedMs },
    {
      "new products become searchable within the wait": (s) => s.searchable !== undefined,
    },
  );
  if (searchable.elapsedMs === undefined) return;
  const productIds = skus.map((sku) => searchable.found.get(sku)[0].id);

  const productRerun = manager.post("/api/products/imports", productPayload(skus), { name: "POST /products/imports" });
  productImportMs.add(productRerun.timings.duration);
  check(productRerun, {
    "product re-run is idempotent: same counts": (r) => {
      const summary = r.json()?.summary;
      return (
        r.status === 200 && summary?.products === ROWS && summary?.productUnits === ROWS && summary?.prices === ROWS
      );
    },
  });
  const afterRerun = lookupSkus(manager, skus);
  check(afterRerun, {
    "product re-run creates no duplicate SKUs": (found) => skus.every((sku) => found.get(sku).length === 1),
  });

  // A bad row rejects the whole product payload. Its valid rows must not become searchable.
  const badSkus = skusFor(run, "E");
  const productBad = manager.post("/api/products/imports", productPayload(badSkus, INVALID_ROW), {
    name: "POST /products/imports (bad row)",
    expect: [400],
  });
  check(productBad, {
    "product import with a bad row is rejected (400 invalid_import)": (r) =>
      r.status === 400 && r.json()?.code === "invalid_import",
    "the rejection names the bad row by path": (r) =>
      (r.json()?.errors ?? []).some((error) => error.path === `products.${INVALID_ROW}.name`),
  });
  // Search only: it reads the index, so this proves absence from the index, not from the database.
  check(lookupSkus(manager, badSkus), {
    "no valid row of the rejected product payload is in the catalog index": (found) =>
      badSkus.every((sku) => found.get(sku).length === 0),
  });
  businessRejections.add(1, { reason: "invalid_row" });

  // Opening balances: import, check availability catches up, then re-run the same file.
  const balances = balancePayload(skus, data.siteId, data.storageLocationId, run);
  const balanceFirst = warehouse.post("/api/inventory/imports/opening-balances", balances, {
    name: "POST /inventory/imports/opening-balances",
  });
  openingBalanceImportMs.add(balanceFirst.timings.duration);
  check(balanceFirst, {
    "opening balance import accepted (200)": (r) => r.status === 200 && r.json()?.status === "imported",
    "opening balance import creates 20 balances and batches": (r) => {
      const summary = r.json()?.summary;
      return summary?.created === ROWS && summary?.unchanged === 0 && summary?.batchesCreated === ROWS;
    },
  });
  const availabilityMs = waitForAvailability(manager, data.siteId, productIds);
  if (availabilityMs !== undefined) availabilityCatchUpMs.add(availabilityMs);
  check(
    { availabilityMs },
    {
      "imported stock appears in availability within the wait": (s) => s.availabilityMs !== undefined,
    },
  );

  const balanceRerun = warehouse.post("/api/inventory/imports/opening-balances", balances, {
    name: "POST /inventory/imports/opening-balances",
  });
  openingBalanceImportMs.add(balanceRerun.timings.duration);
  check(balanceRerun, {
    "opening balance re-run is idempotent: every row unchanged": (r) => {
      const summary = r.json()?.summary;
      return r.status === 200 && summary?.created === 0 && summary?.unchanged === ROWS && summary?.batchesCreated === 0;
    },
  });

  // A bad balance row rejects the whole payload: none of its batches may be stored (checked in inventory, not search).
  const badBatchTag = `${run}-EB`;
  const balanceBad = warehouse.post(
    "/api/inventory/imports/opening-balances",
    balancePayload(skus, data.siteId, data.storageLocationId, badBatchTag, INVALID_ROW),
    { name: "POST /inventory/imports/opening-balances (bad row)", expect: [400] },
  );
  check(balanceBad, {
    "opening balance import with a bad row is rejected (400 invalid_import)": (r) =>
      r.status === 400 && r.json()?.code === "invalid_import",
    "the rejection names the bad row by path": (r) =>
      (r.json()?.errors ?? []).some((error) => error.path === `balances.${INVALID_ROW}.quantityOnHand`),
  });
  businessRejections.add(1, { reason: "invalid_row" });
  const stored = manager
    .get("/api/inventory/balances", { query: { productId: productIds[0] }, name: "GET /inventory/balances" })
    .json();
  check(stored, {
    "no batch of the rejected balance payload was stored": (rows) =>
      Array.isArray(rows) && !rows.some((row) => row.batch?.batchNumber?.startsWith(`K6-IMP-${badBatchTag}`)),
  });
}
