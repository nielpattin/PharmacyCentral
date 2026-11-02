import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductMediaStore } from "./catalog/product-media-store.ts";
import { createCatalogRouter } from "./catalog-routes.ts";
import { DrizzleStoreRepository } from "./stores/infrastructure/drizzle-store-repository.ts";
import { createTrustedRequestMiddleware, matchesPathPrefix } from "../middleware/trusted-request.ts";
import { bearerHeaders, testVerifier } from "../test-support/access-tokens.ts";
import { encodePageCursor } from "../shared/pagination/page-cursor.ts";

const SERVICE_SECRET = "test-internal-service-secret";
const ids = {
  site: "00000000-0000-4000-8000-000000000001",
  product: "00000000-0000-4000-8000-000000000002",
  unit: "00000000-0000-4000-8000-000000000003",
  supplier: "00000000-0000-4000-8000-000000000004",
};

/** The same public catalog reads as `main.ts`: anything else needs an access token. */
const PUBLIC_CATALOG_PATHS = ["/products", "/pricing/active", "/pricing/prices", "/stores", "/availability"];

const signedHeaders = (
  actorType: "customer" | "employee",
  actorId: string,
  roles: string[],
  siteIds: string[] = [],
): Promise<Record<string, string>> => bearerHeaders({ actorType, actorId, roles, siteIds });

const actors = {
  customer: { headers: await signedHeaders("customer", "11111111-1111-4111-8111-111111111111", []) },
  warehouse: {
    headers: await signedHeaders("employee", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ["Warehouse Staff"]),
  },
  manager: {
    headers: await signedHeaders("employee", "66666666-6666-4666-8666-666666666666", ["Pharmacy Manager"]),
  },
  admin: {
    headers: await signedHeaders("employee", "55555555-5555-4555-8555-555555555555", ["Platform Admin"]),
  },
} as const;

const JSON_HEADERS = { "content-type": "application/json" } as const;

const createTestServer = async (
  repository: DrizzleStoreRepository,
  mediaStore?: ProductMediaStore,
): Promise<{ server: Server; url: string }> => {
  const app = express();
  app.use(express.raw({ type: "image/*", limit: "5mb" }));
  app.use(express.json());
  app.use(
    createTrustedRequestMiddleware({
      verifier: testVerifier,
      serviceSecret: SERVICE_SECRET,
      isPublic: (request) =>
        ["GET", "HEAD"].includes(request.method) &&
        PUBLIC_CATALOG_PATHS.some((prefix) => matchesPathPrefix(request.path, prefix)),
    }),
  );
  app.use(createCatalogRouter(repository, mediaStore, { verifier: testVerifier }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) =>
    response.status(500).json({ error: String(error) }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
};

describe("catalog API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
  });

  it("preserves product metadata and image placeholders on create", async () => {
    const updateUnit = vi
      .fn<(id: string, input: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.unit, unitName: "Box" });
    const deleteUnit = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const createProduct = vi
      .fn<(input: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.product, notes: "Product note", status: "Active" });
    const repository = {
      updateProductUnit: updateUnit,
      deleteProductUnit: deleteUnit,
      createProduct,
    } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const productResponse = await fetch(`${testServer.url}/products`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...actors.manager.headers },
      body: JSON.stringify({
        sku: "SKU-001",
        name: "Product",
        category: "Medicine",
        manufacturer: "Maker",
        genericName: "Paracetamol",
        activeIngredient: "Paracetamol 500 mg",
        strength: "500 mg",
        dosageForm: "Tablet",
        packageDescription: "Box of 100 tablets",
        registrationNumber: "VD-TEST-001",
        prescriptionRequired: false,
        imageUrl: null,
        notes: "Product note",
        status: "Active",
        isActive: true,
        barcode: null,
      }),
    });
    const updateResponse = await fetch(`${testServer.url}/products/${ids.product}/units/${ids.unit}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, ...actors.manager.headers },
      body: JSON.stringify({
        unitName: "Box",
        conversionFactorToBaseUnit: 10,
        isBaseUnit: false,
        isDefaultSaleUnit: true,
        isDefaultPurchaseUnit: false,
        sortOrder: 1,
      }),
    });
    const deleteResponse = await fetch(`${testServer.url}/products/${ids.product}/units/${ids.unit}`, {
      method: "DELETE",
      headers: actors.manager.headers,
    });

    expect(productResponse.status).toBe(201);
    expect(updateResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(204);
    expect(createProduct.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        genericName: "Paracetamol",
        activeIngredient: "Paracetamol 500 mg",
        strength: "500 mg",
        dosageForm: "Tablet",
        packageDescription: "Box of 100 tablets",
        registrationNumber: "VD-TEST-001",
        prescriptionRequired: false,
        imageUrl: null,
        notes: "Product note",
      }),
    );
    expect(updateUnit).toHaveBeenCalledWith(ids.unit, expect.objectContaining({ unitName: "Box" }));
    expect(deleteUnit).toHaveBeenCalledWith(ids.unit);
  });

  it("preserves site and supplier notes and statuses", async () => {
    const createSite = vi
      .fn<(input: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.site, status: "Active" });
    const createSupplier = vi
      .fn<(input: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValue({ id: ids.supplier, status: "Active" });
    const repository = { createSite, createSupplier } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const siteResponse = await fetch(`${testServer.url}/sites`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...actors.admin.headers },
      body: JSON.stringify({
        code: "SITE-001",
        name: "Site",
        siteType: "RetailStore",
        address: "Address",
        status: "Active",
        notes: "Site note",
        isActive: true,
      }),
    });
    const supplierResponse = await fetch(`${testServer.url}/suppliers`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...actors.manager.headers },
      body: JSON.stringify({
        code: "SUP-001",
        name: "Supplier",
        status: "Active",
        notes: "Supplier note",
        isActive: true,
      }),
    });

    expect(siteResponse.status).toBe(201);
    expect(supplierResponse.status).toBe(201);
    expect(createSite.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ status: "Active", notes: "Site note", isActive: true }),
    );
    expect(createSupplier.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ status: "Active", notes: "Supplier note", isActive: true }),
    );
  });

  it("rejects site-specific price drafts", async () => {
    const createPrice = vi
      .fn<(input: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValue({ id: "price" });
    const repository = { createPrice } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/pricing/prices`, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        ...(await signedHeaders("employee", "66666666-6666-4666-8666-666666666666", ["Pharmacy Manager"], [ids.site])),
      },
      body: JSON.stringify({
        productId: ids.product,
        productUnitId: ids.unit,
        siteId: ids.site,
        unitPrice: 12500,
        currency: "VND",
        effectiveFrom: "2026-01-01",
      }),
    });

    expect(response.status).toBe(400);
    expect(createPrice).not.toHaveBeenCalled();
  });

  it("stores an image and persists its public URL on the product", async () => {
    const getProduct = vi.fn<(id: string) => Promise<unknown>>().mockResolvedValue({ id: ids.product });
    const updateProduct = vi.fn<(id: string, input: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({
      id: ids.product,
      imageUrl: "http://localhost:9000/product-media/products/product/image.jpg",
    });
    const store = vi
      .fn<(productId: string, image: Buffer) => Promise<{ imageUrl: string }>>()
      .mockResolvedValue({ imageUrl: "http://localhost:9000/product-media/products/product/image.jpg" });
    const mediaStore = { store } as unknown as ProductMediaStore;
    const repository = { getProduct, updateProduct } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository, mediaStore);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/products/${ids.product}/image`, {
      method: "PUT",
      headers: { "content-type": "image/jpeg", ...actors.manager.headers },
      body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });

    expect(response.status).toBe(200);
    expect(store).toHaveBeenCalledWith(ids.product, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(updateProduct).toHaveBeenCalledWith(ids.product, {
      imageUrl: "http://localhost:9000/product-media/products/product/image.jpg",
    });
  });

  it("pages the product list with an opaque cursor and answers a repeated page from memory", async () => {
    const rows = [1, 2, 3].map((n) => ({ id: `product-${n}`, sku: `SKU-${n}` }));
    const searchProducts = vi
      .fn<(query: { limit: number; offset: number }) => Promise<unknown[]>>()
      .mockImplementation(async ({ limit, offset }) => rows.slice(offset, offset + limit));
    const listUnitsByProductIds = vi.fn().mockResolvedValue(new Map());
    const repository = { searchProducts, listUnitsByProductIds } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const first = await fetch(`${testServer.url}/products?limit=2`);
    const cursor = first.headers.get("x-next-cursor");
    const second = await fetch(`${testServer.url}/products?limit=2&cursor=${cursor}`);
    await fetch(`${testServer.url}/products?limit=2`);
    const invalid = await fetch(`${testServer.url}/products?limit=2&cursor=0`);

    expect(((await first.json()) as Array<{ sku: string }>).map((p) => p.sku)).toEqual(["SKU-1", "SKU-2"]);
    expect(cursor).not.toBeNull();
    expect(((await second.json()) as Array<{ sku: string }>).map((p) => p.sku)).toEqual(["SKU-3"]);
    expect(second.headers.get("x-next-cursor")).toBeNull();
    expect(invalid.status).toBe(400);
    expect(searchProducts).toHaveBeenCalledTimes(2);
  });

  it("pages the price list newest first, continuing each page after the last row it returned", async () => {
    const priceIds = {
      newest: "00000000-0000-4000-8000-0000000000a1",
      middle: "00000000-0000-4000-8000-0000000000a2",
      oldest: "00000000-0000-4000-8000-0000000000a3",
    };
    const listPrices = vi
      .fn<(input: { after?: { sortValue: string; id: string } }) => Promise<unknown>>()
      .mockResolvedValueOnce({
        rows: [
          { id: priceIds.newest, effectiveFrom: "2026-03-01" },
          { id: priceIds.middle, effectiveFrom: "2026-03-01" },
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({ rows: [{ id: priceIds.oldest, effectiveFrom: "2026-01-01" }], hasMore: false });
    const repository = { listPrices } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const first = await fetch(`${testServer.url}/pricing/prices?limit=2`);
    const cursor = first.headers.get("x-next-cursor");
    const second = await fetch(`${testServer.url}/pricing/prices?limit=2&cursor=${cursor}`);

    expect(cursor).not.toBeNull();
    expect(listPrices.mock.calls[0]?.[0]?.after).toBeUndefined();
    expect(listPrices.mock.calls[1]?.[0]?.after).toEqual({ sortValue: "2026-03-01", id: priceIds.middle });
    expect(((await first.json()) as Array<{ id: string }>).map((price) => price.id)).toEqual([
      priceIds.newest,
      priceIds.middle,
    ]);
    expect(((await second.json()) as Array<{ id: string }>).map((price) => price.id)).toEqual([priceIds.oldest]);
    expect(second.headers.get("x-next-cursor")).toBeNull();
  });

  it("answers invalid_cursor for a cursor the price list did not issue, before reading any price", async () => {
    const listPrices = vi.fn<(input: Record<string, unknown>) => Promise<unknown>>();
    const repository = { listPrices } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const malformed = await fetch(`${testServer.url}/pricing/prices?cursor=not-a-cursor`);
    const wrongSortValue = await fetch(
      `${testServer.url}/pricing/prices?cursor=${encodePageCursor({ sortValue: "yesterday", id: ids.product })}`,
    );

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual(expect.objectContaining({ code: "invalid_cursor" }));
    expect(wrongSortValue.status).toBe(400);
    expect(listPrices).not.toHaveBeenCalled();
  });

  it("passes the product, status, text and limit of the price list to the repository, with a default limit of 100", async () => {
    const listPrices = vi
      .fn<(input: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValue({ rows: [], hasMore: false });
    const repository = { listPrices } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    await fetch(`${testServer.url}/pricing/prices?productId=${ids.product}&status=Published&q=para&limit=500`);
    await fetch(`${testServer.url}/pricing/prices`);

    expect(listPrices).toHaveBeenNthCalledWith(1, {
      productId: ids.product,
      status: "Published",
      q: "para",
      after: undefined,
      limit: 500,
    });
    // A caller with no session reads Published prices, so the default status is the one a shopper sees.
    expect(listPrices).toHaveBeenNthCalledWith(2, { status: "Published", after: undefined, limit: 100 });
  });

  it("lets staff read Draft and Archived prices, and narrows every other caller to Published", async () => {
    const listPrices = vi
      .fn<(input: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValue({ rows: [], hasMore: false });
    const countPrices = vi.fn<(input: Record<string, unknown>) => Promise<number>>().mockResolvedValue(0);
    const repository = { listPrices, countPrices } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    await fetch(`${testServer.url}/pricing/prices?status=Draft`, { headers: actors.manager.headers });
    await fetch(`${testServer.url}/pricing/prices?status=Archived`);
    await fetch(`${testServer.url}/pricing/prices?status=Draft`, { headers: actors.customer.headers });
    await fetch(`${testServer.url}/pricing/prices/count?status=Draft`);
    await fetch(`${testServer.url}/pricing/prices/count?status=Draft`, { headers: actors.warehouse.headers });

    expect(listPrices.mock.calls.map(([input]) => input.status)).toEqual(["Draft", "Published", "Published"]);
    expect(countPrices.mock.calls.map(([input]) => input.status)).toEqual(["Published", "Draft"]);
  });

  it("counts products and prices, and never reads the count paths as a product id", async () => {
    const countProducts = vi.fn<(input: Record<string, unknown>) => Promise<number>>().mockResolvedValue(7);
    const countPrices = vi.fn<(input: Record<string, unknown>) => Promise<number>>().mockResolvedValue(3);
    const getProduct = vi.fn<(id: string) => Promise<unknown>>();
    const repository = {
      countProducts,
      countPrices,
      getProduct,
    } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const products = await fetch(`${testServer.url}/products/count?search=para&prescriptionRequired=true`);
    const prices = await fetch(`${testServer.url}/pricing/prices/count?status=Published&q=para`);

    expect(await products.json()).toEqual({ count: 7 });
    expect(await prices.json()).toEqual({ count: 3 });
    expect(countProducts).toHaveBeenCalledWith({ search: "para", prescriptionRequired: true });
    expect(countPrices).toHaveBeenCalledWith({ status: "Published", q: "para" });
    expect(getProduct).not.toHaveBeenCalled();
  });

  it("answers one base-unit row per active product for the requested day, defaulting to today, and refuses a bad day", async () => {
    const rows = [{ productId: ids.product, productName: "Paracetamol 500mg", unitPrice: null }];
    const listBasePricesOn = vi.fn<(day: string) => Promise<unknown[]>>().mockResolvedValue(rows);
    const repository = { listBasePricesOn } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const dated = await fetch(`${testServer.url}/pricing/base-prices?day=2026-10-20`, {
      headers: actors.customer.headers,
    });
    const today = await fetch(`${testServer.url}/pricing/base-prices`, { headers: actors.customer.headers });
    const invalid = await fetch(`${testServer.url}/pricing/base-prices?day=2026-13-01`, {
      headers: actors.customer.headers,
    });

    expect(await dated.json()).toEqual(rows);
    expect(today.status).toBe(200);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual(expect.objectContaining({ code: "invalid_request" }));
    expect(listBasePricesOn).toHaveBeenCalledTimes(2);
    expect(listBasePricesOn).toHaveBeenNthCalledWith(1, "2026-10-20");
    expect(listBasePricesOn).toHaveBeenNthCalledWith(2, new Date().toISOString().slice(0, 10));
  });

  it("answers every product's grouping to the period analytics, service only", async () => {
    const rows = [
      {
        productId: ids.product,
        productName: "Paracetamol 500mg",
        category: "Medicine",
        prescriptionRequired: false,
      },
    ];
    const listProductClassifications = vi.fn<() => Promise<unknown[]>>().mockResolvedValue(rows);
    const repository = { listProductClassifications } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const answer = await fetch(`${testServer.url}/internal/analytics/products`, {
      headers: { "x-internal-service-secret": SERVICE_SECRET },
    });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ products: rows });
    expect(listProductClassifications).toHaveBeenCalledTimes(1);

    const employee = await fetch(`${testServer.url}/internal/analytics/products`, {
      headers: actors.manager.headers,
    });
    expect(employee.status).toBe(403);
    expect(await employee.json()).toMatchObject({ code: "service_required" });
  });

  it("answers a product by its id with its units, as before the count routes", async () => {
    const getProduct = vi.fn<(id: string) => Promise<unknown>>().mockResolvedValue({ id: ids.product, sku: "SKU-001" });
    const listProductUnits = vi
      .fn<(id: string) => Promise<unknown[]>>()
      .mockResolvedValue([{ id: ids.unit, unitName: "Box" }]);
    const repository = { getProduct, listProductUnits } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/products/${ids.product}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: ids.product,
      sku: "SKU-001",
      units: [{ id: ids.unit, unitName: "Box" }],
    });
    expect(getProduct).toHaveBeenCalledWith(ids.product);
  });

  it("pages the stores by code and answers a cursor only while another store follows", async () => {
    const firstStore = "00000000-0000-4000-8000-0000000000d1";
    const listActiveStores = vi
      .fn<(limit: number, after?: { sortValue: string; id: string }) => Promise<unknown>>()
      .mockResolvedValueOnce({ rows: [{ id: firstStore, code: "SITE-001" }], hasMore: true })
      .mockResolvedValueOnce({ rows: [{ id: ids.site, code: "SITE-002" }], hasMore: false });
    const repository = { listActiveStores } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    const first = await fetch(`${testServer.url}/stores?limit=1`);
    const cursor = first.headers.get("x-next-cursor");
    const second = await fetch(`${testServer.url}/stores?limit=1&cursor=${cursor}`);
    const malformed = await fetch(`${testServer.url}/stores?cursor=not-a-cursor`);

    expect(cursor).not.toBeNull();
    expect(listActiveStores.mock.calls[0]).toEqual([1, undefined]);
    expect(listActiveStores.mock.calls[1]).toEqual([1, { sortValue: "SITE-001", id: firstStore }]);
    expect(second.headers.get("x-next-cursor")).toBeNull();
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual(expect.objectContaining({ code: "invalid_cursor" }));
    expect(listActiveStores).toHaveBeenCalledTimes(2);
  });

  it("answers one active store to a caller that signed in as nobody, and 404 for any other", async () => {
    const store = {
      id: ids.site,
      code: "SITE-001",
      name: "Nhà thuốc Quận 4",
      address: "268 Tôn Đản",
      coordinates: { latitude: 10.773, longitude: 106.704 },
    };
    const findActiveStore = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockImplementation(async (id) => (id === ids.site ? store : undefined));
    const testServer = await createTestServer({ findActiveStore } as unknown as DrizzleStoreRepository);
    server = testServer.server;

    const found = await fetch(`${testServer.url}/stores/${ids.site}`);
    const missing = await fetch(`${testServer.url}/stores/00000000-0000-4000-8000-0000000000e9`);
    const malformed = await fetch(`${testServer.url}/stores/not-an-id`);

    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(store);
    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(400);
  });

  it("filters sites, storage locations and suppliers by code or name with q, and leaves them whole without it", async () => {
    const listSites = vi.fn<(search?: string, siteIds?: string[]) => Promise<unknown[]>>().mockResolvedValue([]);
    const listStorageLocations = vi
      .fn<(siteIds?: string[], search?: string) => Promise<unknown[]>>()
      .mockResolvedValue([]);
    const listSuppliers = vi.fn<(search?: string) => Promise<unknown[]>>().mockResolvedValue([]);
    const repository = { listSites, listStorageLocations, listSuppliers } as unknown as DrizzleStoreRepository;
    const testServer = await createTestServer(repository);
    server = testServer.server;

    await fetch(`${testServer.url}/sites?q=SITE`, { headers: actors.admin.headers });
    await fetch(`${testServer.url}/sites`, { headers: actors.admin.headers });
    await fetch(`${testServer.url}/storage-locations?siteId=${ids.site}&q=shelf`, { headers: actors.admin.headers });
    await fetch(`${testServer.url}/suppliers?q=%25`, { headers: actors.warehouse.headers });
    const tooLong = await fetch(`${testServer.url}/suppliers?q=${"a".repeat(201)}`, {
      headers: actors.warehouse.headers,
    });

    expect(listSites).toHaveBeenNthCalledWith(1, "SITE", undefined);
    expect(listSites).toHaveBeenNthCalledWith(2, undefined, undefined);
    expect(listStorageLocations).toHaveBeenCalledWith([ids.site], "shelf");
    expect(listSuppliers).toHaveBeenCalledWith("%");
    expect(tooLong.status).toBe(400);
    expect(listSuppliers).toHaveBeenCalledTimes(1);
  });
});
