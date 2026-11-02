import express from "express";
import { createServer, type Server } from "node:http";

import { ReadThroughCache, type CacheOperation, type CacheStore } from "@pharmacy/cache";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AvailabilityProjection } from "./availability/application/availability-projection.ts";
import { CATALOG_CACHE_NAMESPACE } from "./catalog/read-cache.ts";
import { createCatalogRouter } from "./catalog-routes.ts";
import type { DrizzleStoreRepository } from "./stores/infrastructure/drizzle-store-repository.ts";
import type { CatalogDatabase } from "../shared/infrastructure/database.ts";
import { createTrustedRequestMiddleware, matchesPathPrefix } from "../middleware/trusted-request.ts";
import { bearerHeaders, testVerifier } from "../test-support/access-tokens.ts";

const SERVICE_SECRET = "test-internal-service-secret";
const PUBLIC_CATALOG_PATHS = ["/products", "/pricing/active", "/pricing/prices", "/stores", "/availability"];
const ids = {
  site: "00000000-0000-4000-8000-000000000001",
  otherSite: "00000000-0000-4000-8000-000000000005",
  product: "00000000-0000-4000-8000-000000000002",
  unit: "00000000-0000-4000-8000-000000000003",
  price: "00000000-0000-4000-8000-000000000006",
};
const JSON_HEADERS = { "content-type": "application/json" } as const;

const signedHeaders = (
  actorType: "customer" | "employee",
  actorId: string,
  roles: string[],
): Promise<Record<string, string>> => bearerHeaders({ actorType, actorId, roles });

const actors = {
  customerA: { headers: await signedHeaders("customer", "11111111-1111-4111-8111-111111111111", []) },
  customerB: { headers: await signedHeaders("customer", "22222222-2222-4222-8222-222222222222", []) },
  manager: { headers: await signedHeaders("employee", "66666666-6666-4666-8666-666666666666", ["Pharmacy Manager"]) },
  admin: { headers: await signedHeaders("employee", "55555555-5555-4555-8555-555555555555", ["Platform Admin"]) },
} as const;

/** An in-memory store. Set `failing` to make every command reject, as when Redis is down. */
const memoryCacheStore = () => {
  const values = new Map<string, string>();
  const state = { failing: false };
  const store: CacheStore = {
    get: async (key) => {
      if (state.failing) throw new Error("connect ECONNREFUSED");
      return values.get(key) ?? null;
    },
    set: async (key, value) => {
      if (state.failing) throw new Error("connect ECONNREFUSED");
      values.set(key, value);
    },
    increment: async (key) => {
      if (state.failing) throw new Error("connect ECONNREFUSED");
      const next = Number(values.get(key) ?? "0") + 1;
      values.set(key, String(next));
      return next;
    },
  };
  return { store, state };
};

const store = {
  id: ids.site,
  code: "S1",
  name: "Store one",
  address: "1 Street",
  coordinates: null,
};

const product = { id: ids.product, sku: "SKU-1", name: "Paracetamol", units: [] };

const repositoryMock = () => ({
  findActiveStore: vi.fn(async (_id: string) => store),
  listActiveStores: vi.fn(async (_limit: number, _after?: unknown) => ({
    rows: [store],
    hasMore: true,
  })),
  getProduct: vi.fn(async (_id: string) => product),
  listProductUnits: vi.fn(async (_id: string) => []),
  getActivePrice: vi.fn(async (_productId: string, _unitId: string, _date: string) => ({
    id: ids.price,
    unitPrice: "1000.00",
  })),
  listAvailability: vi.fn(async (_productId?: string, _siteIds?: string[]) => [
    { productId: ids.product, siteId: ids.site, inStock: true },
  ]),
  createSite: vi.fn(async () => store),
  transitionPrice: vi.fn(async () => ({ id: ids.price, status: "Published" })),
  updateProductUnit: vi.fn(async () => ({ id: ids.unit })),
});

type Mock = ReturnType<typeof repositoryMock>;

const createTestServer = async (
  repository: Mock,
  cache: ReadThroughCache | undefined,
): Promise<{ server: Server; url: string }> => {
  const app = express();
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
  app.use(
    createCatalogRouter(repository as unknown as DrizzleStoreRepository, undefined, {
      verifier: testVerifier,
      cache,
    }),
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

describe("catalog read cache", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await closeServer(server);
    server = undefined;
  });

  const startWith = async (repository: Mock, cache?: ReadThroughCache) => {
    const started = await createTestServer(repository, cache);
    server = started.server;
    return started.url;
  };
  const cacheOver = (cacheStore: CacheStore, warn?: (error: unknown, operation: CacheOperation) => void) =>
    new ReadThroughCache(cacheStore, { namespace: CATALOG_CACHE_NAMESPACE, warn });

  it("serves a store detail from Redis on the second read", async () => {
    const repository = repositoryMock();
    const url = await startWith(repository, cacheOver(memoryCacheStore().store));

    const first = await fetch(`${url}/stores/${ids.site}`);
    const second = await fetch(`${url}/stores/${ids.site}`);

    expect(first.status).toBe(200);
    expect(await second.json()).toEqual(store);
    expect(repository.findActiveStore).toHaveBeenCalledTimes(1);
  });

  it("drops the store entries when a site is created, so the next read is fresh", async () => {
    const repository = repositoryMock();
    const url = await startWith(repository, cacheOver(memoryCacheStore().store));

    await fetch(`${url}/stores/${ids.site}`);
    const created = await fetch(`${url}/sites`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...actors.admin.headers },
      body: JSON.stringify({ code: "S2", name: "Store two", siteType: "Pharmacy" }),
    });
    await fetch(`${url}/stores/${ids.site}`);

    expect(created.status).toBe(201);
    expect(repository.findActiveStore).toHaveBeenCalledTimes(2);
  });

  it("keeps the next-page cursor header on a cached store page", async () => {
    const repository = repositoryMock();
    const url = await startWith(repository, cacheOver(memoryCacheStore().store));

    const first = await fetch(`${url}/stores?limit=1`);
    const cursor = first.headers.get("x-next-cursor");
    const second = await fetch(`${url}/stores?limit=1`);

    expect(cursor).toBeTruthy();
    expect(second.headers.get("x-next-cursor")).toBe(cursor);
    expect(repository.listActiveStores).toHaveBeenCalledTimes(1);
  });

  it("does not cache a missing product, so a product created later is found at once", async () => {
    const repository = repositoryMock();
    repository.getProduct.mockResolvedValueOnce(undefined as unknown as typeof product);
    const url = await startWith(repository, cacheOver(memoryCacheStore().store));

    const missing = await fetch(`${url}/products/${ids.product}`);
    const found = await fetch(`${url}/products/${ids.product}`);

    expect(missing.status).toBe(404);
    expect(found.status).toBe(200);
    expect(repository.getProduct).toHaveBeenCalledTimes(2);
  });

  it("drops the product entries when a unit changes, because the product detail carries its units", async () => {
    const repository = repositoryMock();
    const url = await startWith(repository, cacheOver(memoryCacheStore().store));

    await fetch(`${url}/products/${ids.product}`);
    await fetch(`${url}/products/${ids.product}/units/${ids.unit}`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, ...actors.manager.headers },
      body: JSON.stringify({ unitName: "Box", conversionFactorToBaseUnit: 10 }),
    });
    await fetch(`${url}/products/${ids.product}`);

    expect(repository.getProduct).toHaveBeenCalledTimes(2);
  });

  it("serves the active price from Redis and drops it when a price is published", async () => {
    const repository = repositoryMock();
    const url = await startWith(repository, cacheOver(memoryCacheStore().store));
    const query = `productId=${ids.product}&productUnitId=${ids.unit}&effectiveDate=2026-11-01`;

    await fetch(`${url}/pricing/active?${query}`);
    await fetch(`${url}/pricing/active?${query}`);
    expect(repository.getActivePrice).toHaveBeenCalledTimes(1);

    await fetch(`${url}/pricing/prices/${ids.price}/publish`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...actors.manager.headers },
      body: JSON.stringify({}),
    });
    await fetch(`${url}/pricing/active?${query}`);

    expect(repository.getActivePrice).toHaveBeenCalledTimes(2);
  });

  it("shares a public availability answer between shoppers, but keeps each site filter apart", async () => {
    const repository = repositoryMock();
    const url = await startWith(repository, cacheOver(memoryCacheStore().store));

    const a = await fetch(`${url}/availability?siteId=${ids.site}`, { headers: actors.customerA.headers });
    const b = await fetch(`${url}/availability?siteId=${ids.site}`, { headers: actors.customerB.headers });
    const other = await fetch(`${url}/availability?siteId=${ids.otherSite}`, { headers: actors.customerB.headers });

    expect(await a.json()).toEqual(await b.json());
    expect(other.status).toBe(200);
    expect(repository.listAvailability).toHaveBeenCalledTimes(2);
  });

  it("answers every read from the database when Redis is down, and reports the failure", async () => {
    const repository = repositoryMock();
    const cacheStore = memoryCacheStore();
    cacheStore.state.failing = true;
    const warn = vi.fn();
    const url = await startWith(repository, cacheOver(cacheStore.store, warn));

    const first = await fetch(`${url}/stores/${ids.site}`);
    const second = await fetch(`${url}/stores/${ids.site}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(repository.findActiveStore).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
  });

  it("keeps the catalog reading from the database when no cache is configured", async () => {
    const repository = repositoryMock();
    const url = await startWith(repository, undefined);

    await fetch(`${url}/stores/${ids.site}`);
    await fetch(`${url}/stores/${ids.site}`);

    expect(repository.findActiveStore).toHaveBeenCalledTimes(2);
  });
});

describe("AvailabilityProjection", () => {
  const fakeDatabase = (fail: boolean) =>
    ({
      db: {
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: async () => {
              if (fail) throw new Error("deadlock detected");
            },
          }),
        }),
      },
    }) as unknown as CatalogDatabase;

  it("tells the cache after each stored change", async () => {
    const onApplied = vi.fn(async () => undefined);
    const projection = new AvailabilityProjection(fakeDatabase(false), { onApplied });

    await projection.apply({ productId: ids.product, siteId: ids.site, inStock: false });

    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("does not tell the cache when the change was not stored", async () => {
    const onApplied = vi.fn(async () => undefined);
    const projection = new AvailabilityProjection(fakeDatabase(true), { onApplied });

    await expect(projection.apply({ productId: ids.product, siteId: ids.site, inStock: false })).rejects.toThrow();
    expect(onApplied).not.toHaveBeenCalled();
  });
});
