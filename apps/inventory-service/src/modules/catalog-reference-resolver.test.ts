import { describe, expect, it, vi } from "vitest";

import { CatalogServiceReferenceResolver } from "./catalog-reference-resolver.ts";

const ids = {
  product: "00000000-0000-4000-8000-000000000002",
  site: "00000000-0000-4000-8000-000000000003",
  location: "00000000-0000-4000-8000-000000000004",
  supplier: "00000000-0000-4000-8000-000000000005",
};

const createFetch = () => {
  const productsSearch = vi.fn();
  const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/products") {
      productsSearch(url.searchParams.get("search"));
      return Response.json([{ id: ids.product, sku: url.searchParams.get("search") }]);
    }
    if (url.pathname === `/products/${ids.product}`) return Response.json({ id: ids.product, sku: "THU-0001" });
    if (url.pathname === "/sites") return Response.json([{ id: ids.site, code: "SITE-WH" }]);
    if (url.pathname === "/storage-locations") {
      return Response.json([{ id: ids.location, siteId: ids.site, code: "WH-A" }]);
    }
    if (url.pathname === `/storage-locations/${ids.location}`) {
      return Response.json({ id: ids.location, siteId: ids.site, code: "WH-A" });
    }
    if (url.pathname === "/suppliers") return Response.json([{ id: ids.supplier, code: "SUP-001" }]);
    if (url.pathname === `/suppliers/${ids.supplier}`) {
      return Response.json({ id: ids.supplier, code: "SUP-001" });
    }
    return new Response("not found", { status: 404 });
  });
  return { fetchImplementation, productsSearch };
};

const authorization = "Bearer signed-for-catalog";

const resolverFor = (fetchImplementation: typeof fetch) =>
  new CatalogServiceReferenceResolver("http://catalog.local", authorization, fetchImplementation);

describe("CatalogServiceReferenceResolver", () => {
  it("forwards the importing employee's authorization with every catalog lookup", async () => {
    const { fetchImplementation } = createFetch();
    await resolverFor(fetchImplementation).resolve({
      productId: ids.product,
      siteCode: "SITE-WH",
      storageLocationCode: "WH-A",
      batchNumber: "LOT-1",
      quantityOnHand: 100,
      expiryDate: "2028-01-05",
      qualityStatus: "Released" as const,
    });

    const calls = fetchImplementation.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, init] of calls) expect(init?.headers).toMatchObject({ Authorization: authorization });
  });

  it("resolves natural keys and caches catalog lookups", async () => {
    const { fetchImplementation, productsSearch } = createFetch();
    const resolver = resolverFor(fetchImplementation);
    const row = {
      productSku: "THU-0001",
      siteCode: "SITE-WH",
      storageLocationCode: "WH-A",
      supplierCode: "SUP-001",
      batchNumber: "LOT-1",
      quantityOnHand: 100,
      expiryDate: "2028-01-05",
      qualityStatus: "Released" as const,
    };

    await expect(resolver.resolve(row)).resolves.toEqual({
      productId: ids.product,
      siteId: ids.site,
      storageLocationId: ids.location,
      supplierId: ids.supplier,
    });
    await expect(resolver.resolve(row)).resolves.toMatchObject({ productId: ids.product });

    expect(productsSearch).toHaveBeenCalledTimes(1);
    const siteCalls = (fetchImplementation.mock.calls as unknown[][]).filter(
      ([input]) => new URL(typeof input === "string" ? input : (input as Request).url).pathname === "/sites",
    );
    expect(siteCalls).toHaveLength(1);
  });

  it("rejects an unknown product SKU", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json([]));
    const resolver = resolverFor(fetchImplementation);

    await expect(
      resolver.resolve({
        productSku: "MISSING",
        siteCode: "SITE-WH",
        storageLocationCode: "WH-A",
        batchNumber: "LOT-1",
        quantityOnHand: 1,
        expiryDate: "2028-01-05",
        qualityStatus: "Released",
      }),
    ).rejects.toThrow("Catalog product not found for SKU MISSING");
  });

  it("validates that an id-based storage location belongs to the selected site", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/sites") return Response.json([{ id: ids.site, code: "SITE-WH" }]);
      if (url.pathname === `/products/${ids.product}`) return Response.json({ id: ids.product, sku: "THU-0001" });
      if (url.pathname === `/storage-locations/${ids.location}`) {
        return Response.json({ id: ids.location, siteId: "00000000-0000-4000-8000-000000000099" });
      }
      return new Response("not found", { status: 404 });
    });
    const resolver = resolverFor(fetchImplementation);

    await expect(
      resolver.resolve({
        productId: ids.product,
        siteCode: "SITE-WH",
        storageLocationId: ids.location,
        batchNumber: "LOT-1",
        quantityOnHand: 1,
        expiryDate: "2028-01-05",
        qualityStatus: "Released",
      }),
    ).rejects.toThrow(`Storage location ${ids.location} does not belong to the selected site`);
  });
});
