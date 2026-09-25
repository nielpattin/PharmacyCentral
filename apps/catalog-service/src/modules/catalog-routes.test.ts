import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductMediaStore } from "./catalog/product-media-store.ts";
import { createCatalogRouter } from "./catalog-routes.ts";
import { DrizzleStoreRepository } from "./stores/infrastructure/drizzle-store-repository.ts";

const ids = {
  site: "00000000-0000-4000-8000-000000000001",
  product: "00000000-0000-4000-8000-000000000002",
  unit: "00000000-0000-4000-8000-000000000003",
  supplier: "00000000-0000-4000-8000-000000000004",
};

const createTestServer = async (
  repository: DrizzleStoreRepository,
  mediaStore?: ProductMediaStore,
): Promise<{ server: Server; url: string }> => {
  const app = express();
  app.use(express.raw({ type: "image/*", limit: "5mb" }));
  app.use(express.json());
  app.use(createCatalogRouter(repository, mediaStore));
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
      headers: { "content-type": "application/json" },
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
      headers: { "content-type": "application/json" },
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "SITE-001",
        name: "Site",
        siteType: "Retail",
        address: "Address",
        status: "Active",
        notes: "Site note",
        isActive: true,
      }),
    });
    const supplierResponse = await fetch(`${testServer.url}/suppliers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
      headers: { "content-type": "application/json" },
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
      headers: { "content-type": "image/jpeg" },
      body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });

    expect(response.status).toBe(200);
    expect(store).toHaveBeenCalledWith(ids.product, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(updateProduct).toHaveBeenCalledWith(ids.product, {
      imageUrl: "http://localhost:9000/product-media/products/product/image.jpg",
    });
  });
});
