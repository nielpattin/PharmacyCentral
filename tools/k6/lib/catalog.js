// Discovery of stores and sellable products through the public catalog and availability endpoints.

// Verified sellable units kept per VU and store, so picks spread over several rows without re-probing prices.
const POOL_SIZE = 10;
const pools = new Map();

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffled(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function listOf(response, what) {
  const body = response.json();
  if (response.status !== 200 || !Array.isArray(body)) {
    throw new Error(`Could not read ${what} (status ${response.status})`);
  }
  return body;
}

function unitFor(product) {
  const units = product.units ?? [];
  return units.find((unit) => unit.isDefaultSaleUnit) ?? units.find((unit) => unit.isBaseUnit) ?? units[0];
}

function discoverSellable(session, storeId) {
  const availability = listOf(
    session.get("/api/availability", { query: { siteId: storeId }, name: "GET /availability" }),
    "availability",
  );
  const inStock = new Set(availability.filter((row) => row.inStock).map((row) => row.productId));
  const products = listOf(session.get("/api/products", { query: { limit: 100 }, name: "GET /products" }), "products");
  const today = new Date().toISOString().slice(0, 10);
  const sellable = [];
  for (const product of shuffled(products.filter((item) => inStock.has(item.id)))) {
    if (sellable.length >= POOL_SIZE) break;
    const unit = unitFor(product);
    if (!unit) continue;
    // 404 means the unit has no published price, which the sales service would refuse as product_unpriced.
    const price = session.get("/api/pricing/active", {
      query: { productId: product.id, productUnitId: unit.id, effectiveDate: today },
      name: "GET /pricing/active",
      expect: [404],
    });
    if (price.status === 200) sellable.push({ productId: product.id, productUnitId: unit.id });
  }
  if (sellable.length === 0) throw new Error(`Store ${storeId} has no in-stock product with an active price`);
  return sellable;
}

/** A random customer-facing store from the public store list. */
export function pickStore(session) {
  const stores = listOf(session.get("/api/stores", { query: { limit: 50 }, name: "GET /stores" }), "stores");
  if (stores.length === 0) throw new Error("No customer-facing store is available");
  return pick(stores);
}

/** A random `{ productId, productUnitId }` in stock and priced at the store, skipping ids in `exclude`; undefined when none is left. */
export function pickProduct(session, storeId, exclude = []) {
  if (!pools.has(storeId)) pools.set(storeId, discoverSellable(session, storeId));
  const candidates = pools.get(storeId).filter((item) => !exclude.includes(item.productId));
  return candidates.length === 0 ? undefined : pick(candidates);
}
