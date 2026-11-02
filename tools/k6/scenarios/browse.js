// Read-heavy storefront journey that mirrors customer-web: the home list with the store list, Vietnamese text search,
// and a product detail with its availability and active price. Half the iterations browse signed in as the customer.
// Load and stress run on an open model (arrival rate), so the request rate holds when the server slows down.
import http from "k6/http";
import { check } from "k6";

import { accounts, profile, targetUrl } from "../lib/config.js";
import { loginOncePerVu } from "../lib/session.js";

const PROFILE = profile();
const SIGNED_IN_SHARE = 0.5;
const LIST_SHARE = 0.5;
const SEARCH_SHARE = 0.3; // the remaining 20% is detail, availability and pricing
const LIST_PAGE = 20;
const SEARCH_LIMIT = 60; // customer-web's default search limit
const SEARCHED_FIELDS = ["name", "sku", "barcode", "genericName", "activeIngredient", "indications"];

// Terms from data/import-samples/products.csv. "đi ngoài" is a synonym of "tiêu chảy" in one of the six local search
// synonym groups that `pnpm run seed:demo` creates and approves.
const SEARCHES = [
  { term: "paracetamol", kind: "literal" },
  { term: "tiêu chảy", kind: "literal" },
  { term: "tieu chay", kind: "literal" },
  { term: "sổ mũi", kind: "literal" },
  { term: "hạ sốt", kind: "literal" },
  { term: "đau họng", kind: "literal" },
  { term: "paracetmol", kind: "typo", expect: "paracetamol" },
  { term: "đi ngoài", kind: "synonym", expect: "tiêu chảy" },
  { term: "xqzvbnmk", kind: "empty" },
];
const MATCH_CHECKS = {
  literal: "search finds products that contain the term",
  typo: "typo query finds the intended product",
  synonym: "synonym query finds products for the group",
};

function numberEnv(name, fallback) {
  const raw = __ENV[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
  return value;
}

function textEnv(name, fallback) {
  return __ENV[name] || fallback;
}

// Load: a constant arrival rate (RATE iterations per second for DURATION). Stress: ramps to RATE and holds it.
// Smoke: a few iterations on one VU. MAX_VUS caps the VUs the open model may start.
function scenario() {
  if (PROFILE === "smoke") return { executor: "shared-iterations", vus: 1, iterations: 5, maxDuration: "5m" };
  const maxVUs = numberEnv("MAX_VUS", 50);
  const preAllocatedVUs = Math.min(10, maxVUs);
  if (PROFILE === "load") {
    return {
      executor: "constant-arrival-rate",
      rate: numberEnv("RATE", 10),
      timeUnit: "1s",
      duration: textEnv("DURATION", "2m"),
      preAllocatedVUs,
      maxVUs,
    };
  }
  if (PROFILE === "breakpoint") {
    // Steps of 15 s ramp + 45 s hold from 20 to STEP_MAX requests-per-second journeys, so the first failing step is the limit.
    const stepMax = numberEnv("STEP_MAX", 200);
    const stages = [];
    for (let rate = 20; rate <= stepMax; rate += 20) {
      stages.push({ duration: "15s", target: rate }, { duration: "45s", target: rate });
    }
    return {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: Math.min(50, maxVUs),
      maxVUs: numberEnv("MAX_VUS", 400),
      stages,
    };
  }
  const peak = numberEnv("RATE", 40);
  return {
    executor: "ramping-arrival-rate",
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs,
    maxVUs,
    stages: [
      { duration: "30s", target: Math.ceil(peak / 4) },
      { duration: "60s", target: peak },
      { duration: "60s", target: peak },
      { duration: "30s", target: 0 },
    ],
  };
}

const thresholds =
  PROFILE === "breakpoint"
    ? {
        // Stops at the first step past "usable": 5% failures or a 3 s product list.
        http_req_failed: [{ threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "30s" }],
        "http_req_duration{name:GET /products list}": [
          { threshold: "p(95)<3000", abortOnFail: true, delayAbortEval: "30s" },
        ],
      }
    : { http_req_failed: ["rate<0.01"], checks: ["rate>0.99"] };
if (PROFILE === "load") {
  Object.assign(thresholds, {
    "http_req_duration{name:GET /products list}": ["p(95)<300"],
    "http_req_duration{name:GET /products search}": ["p(95)<400"],
    "http_req_duration{name:GET /products detail}": ["p(95)<300"],
  });
}

export const options = {
  scenarios: { browse: scenario() },
  thresholds,
};

// Guest reads need no session and carry no token.
const anonymous = {
  get(path, params = {}) {
    return http.get(targetUrl() + withQuery(path, params.query), {
      headers: { Accept: "application/json" },
      tags: { name: params.name },
    });
  },
};

function withQuery(path, query = {}) {
  const pairs = Object.entries(query).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return pairs.length === 0 ? path : `${path}?${pairs.join("&")}`;
}

function bodyOf(response) {
  try {
    return response.json();
  } catch (_error) {
    return undefined;
  }
}

function listFrom(response, what) {
  const body = bodyOf(response);
  if (response.status !== 200 || !Array.isArray(body)) {
    throw new Error(`Could not read ${what} (status ${response.status})`);
  }
  return body;
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// Same folding as foldSearchText in apps/catalog-service search-text.ts, so the checks compare text the way the index does.
// The mark class is the explicit U+0300-U+036F range: goja (k6's runtime) does not strip marks with \p{M}, and Vietnamese
// diacritics all sit in that block.
function fold(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ|Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesTerm(product, foldedTerm) {
  return SEARCHED_FIELDS.some((field) => fold(product[field]).includes(foldedTerm));
}

// Mirrors activeUnit in apps/customer-web/src/storefront/catalog.ts: the default sale unit, else the base unit, else the first.
function defaultUnit(product) {
  const units = product.units ?? [];
  return (
    units.find((unit) => unit.isDefaultSaleUnit) ??
    units.find((unit) => unit.isBaseUnit) ??
    [...units].sort((left, right) => left.sortOrder - right.sortOrder)[0]
  );
}

// Reads the catalog once, the way customer-web's home page does, and keeps only products with a published price today
// for their sale unit, so the detail journey never meets a price-less product.
export function setup() {
  const today = todayUtc();
  const stores = listFrom(anonymous.get("/api/stores", { query: { limit: 50 }, name: "setup GET /stores" }), "stores");
  const prices = listFrom(
    anonymous.get("/api/pricing/prices", {
      query: { status: "Published", limit: 500 },
      name: "setup GET /pricing/prices",
    }),
    "published prices",
  );
  const priced = new Set(
    prices
      .filter(
        (price) =>
          !price.siteId && price.effectiveFrom <= today && (price.effectiveTo === null || price.effectiveTo >= today),
      )
      .map((price) => `${price.productId}|${price.productUnitId}`),
  );
  const products = listFrom(
    anonymous.get("/api/products", { query: { limit: 100 }, name: "setup GET /products" }),
    "products",
  )
    .map((product) => ({ id: product.id, unitId: defaultUnit(product)?.id }))
    .filter((product) => product.unitId && priced.has(`${product.id}|${product.unitId}`));
  if (stores.length === 0) throw new Error("No customer-facing store is listed");
  if (products.length === 0) throw new Error("No product has a published price for its sale unit today");
  return { stores: stores.map((store) => ({ id: store.id })), products };
}

function listJourney(client) {
  const stores = client.get("/api/stores", { query: { limit: 50 }, name: "GET /stores" });
  const storeRows = bodyOf(stores);
  check(stores, { "stores load (200)": (r) => r.status === 200 });
  check(storeRows, { "stores are listed": (rows) => Array.isArray(rows) && rows.length > 0 });

  const page = client.get("/api/products", { query: { limit: LIST_PAGE }, name: "GET /products list" });
  const rows = bodyOf(page);
  check(page, { "list loads (200)": (r) => r.status === 200 });
  check(rows, {
    "list page holds at most the requested limit": (list) =>
      Array.isArray(list) && list.length > 0 && list.length <= LIST_PAGE,
    "list page has no repeated products": (list) =>
      Array.isArray(list) && new Set(list.map((product) => product.id)).size === list.length,
  });
}

function searchJourney(client) {
  const query = pick(SEARCHES);
  const response = client.get("/api/products", {
    query: { search: query.term, limit: SEARCH_LIMIT },
    name: "GET /products search",
  });
  const rows = bodyOf(response);
  check(response, { "search loads (200)": (r) => r.status === 200 });
  check(rows, {
    "search returns only active products": (list) => Array.isArray(list) && list.every((p) => p.isActive === true),
  });
  if (query.kind === "empty") {
    check(rows, { "nonsense query returns no products": (list) => Array.isArray(list) && list.length === 0 });
    return;
  }
  const expected = fold(query.expect ?? query.term);
  check(rows, {
    [MATCH_CHECKS[query.kind]]: (list) => Array.isArray(list) && list.some((product) => matchesTerm(product, expected)),
  });
}

function detailJourney(client, data) {
  const product = pick(data.products);
  const store = pick(data.stores);

  const detail = client.get(`/api/products/${product.id}`, { name: "GET /products detail" });
  const body = bodyOf(detail);
  check(detail, { "detail loads (200)": (r) => r.status === 200 });
  check(body, {
    "detail is the requested product with its sale unit": (p) =>
      p?.id === product.id && Array.isArray(p.units) && p.units.some((unit) => unit.id === product.unitId),
  });

  // The projection holds one row per product and store, and the API exposes only the boolean flag (no quantity).
  const availability = client.get("/api/availability", {
    query: { siteId: store.id, productId: product.id },
    name: "GET /availability",
  });
  const availabilityRows = bodyOf(availability);
  check(availability, { "availability loads (200)": (r) => r.status === 200 });
  check(availabilityRows, {
    "availability is at most one boolean stock flag for this product and store": (list) =>
      Array.isArray(list) &&
      list.length <= 1 &&
      list.every((row) => row.productId === product.id && row.siteId === store.id && typeof row.inStock === "boolean"),
  });

  const price = client.get("/api/pricing/active", {
    query: { productId: product.id, productUnitId: product.unitId, effectiveDate: todayUtc() },
    name: "GET /pricing/active",
  });
  const priceBody = bodyOf(price);
  check(price, { "active price loads (200)": (r) => r.status === 200 });
  check(priceBody, {
    "active price is published and positive for the unit": (p) =>
      p?.productUnitId === product.unitId && p.status === "Published" && Number(p.unitPrice) > 0,
  });
}

// A signed-in customer also opens their order list, the other read that every account makes.
function ordersJourney(client) {
  const orders = client.get("/api/orders", { query: { limit: 20 }, name: "GET /orders" });
  check(orders, { "order list loads (200)": (r) => r.status === 200 });
}

function browseJourney(client, data) {
  const roll = Math.random();
  if (roll < LIST_SHARE) listJourney(client);
  else if (roll < LIST_SHARE + SEARCH_SHARE) searchJourney(client);
  else detailJourney(client, data);
}

// Guest browsing only: store and product lists, search and product detail, with no sign-in and no token.
export function anonymousBrowse(data) {
  browseJourney(anonymous, data);
}

export default function (data) {
  const signedIn = Math.random() < SIGNED_IN_SHARE;
  const client = signedIn ? loginOncePerVu(accounts.customer) : anonymous;
  if (signedIn && Math.random() < 0.2) ordersJourney(client);
  browseJourney(client, data);
}
