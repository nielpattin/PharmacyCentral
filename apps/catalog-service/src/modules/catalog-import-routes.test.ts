import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTrustedRequestMiddleware } from "../middleware/trusted-request.ts";
import { bearerHeaders, testVerifier } from "../test-support/access-tokens.ts";
import { createCatalogImportRouter } from "./catalog-import-routes.ts";
import type { CatalogImportService } from "./catalog-import-service.ts";

const signedHeaders = (roles: string[]): Promise<Record<string, string>> =>
  bearerHeaders({ actorType: "employee", actorId: "66666666-6666-4666-8666-666666666666", roles });

const MANAGER = await signedHeaders(["Pharmacy Manager"]);

const createTestServer = async (importService: CatalogImportService | undefined) => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(createTrustedRequestMiddleware({ verifier: testVerifier }));
  app.use(createCatalogImportRouter(importService, { verifier: testVerifier }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

describe("catalog import API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server)
      await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
    server = undefined;
  });

  it("imports a catalog payload and returns the summary", async () => {
    const importCatalog = vi.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({
      sites: 1,
      storageLocations: 0,
      suppliers: 0,
      products: 1,
      productUnits: 1,
      prices: 1,
    });
    const testServer = await createTestServer({ import: importCatalog } as unknown as CatalogImportService);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/products/imports`, {
      method: "POST",
      headers: { "content-type": "application/json", ...MANAGER },
      body: JSON.stringify({
        schemaVersion: 1,
        products: [
          {
            sku: "SKU-001",
            name: "Product",
            units: [{ unitName: "Box", conversionFactorToBaseUnit: 1, isBaseUnit: true }],
            price: { unitPrice: 12000, effectiveFrom: "2025-01-01" },
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "imported",
      summary: { sites: 1, storageLocations: 0, suppliers: 0, products: 1, productUnits: 1, prices: 1 },
    });
    const [imported] = importCatalog.mock.calls[0] ?? [];
    expect(imported).toMatchObject({
      schemaVersion: 1,
      products: [{ sku: "SKU-001", price: { currency: "VND", status: "Published" } }],
    });
  });

  it("refuses an import from a Pharmacist with 403 role_forbidden, before reading the payload", async () => {
    const importCatalog = vi.fn<(input: unknown) => Promise<unknown>>();
    const testServer = await createTestServer({ import: importCatalog } as unknown as CatalogImportService);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/products/imports`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await signedHeaders(["Pharmacist"])) },
      body: JSON.stringify({ schemaVersion: 1, suppliers: [{ code: "SUP", name: "Supplier" }] }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "role_forbidden", status: 403 });
    expect(importCatalog).not.toHaveBeenCalled();
  });

  it("rejects an empty or malformed payload", async () => {
    const testServer = await createTestServer({
      import: vi.fn<(input: unknown) => Promise<unknown>>(),
    } as unknown as CatalogImportService);
    server = testServer.server;

    const emptyResponse = await fetch(`${testServer.url}/products/imports`, {
      method: "POST",
      headers: { "content-type": "application/json", ...MANAGER },
      body: JSON.stringify({ schemaVersion: 1 }),
    });
    const malformedResponse = await fetch(`${testServer.url}/products/imports`, {
      method: "POST",
      headers: { "content-type": "application/json", ...MANAGER },
      body: JSON.stringify({ schemaVersion: 2, sites: [{ code: "S" }] }),
    });

    expect(emptyResponse.status).toBe(400);
    expect(malformedResponse.status).toBe(400);
    expect(await malformedResponse.json()).toMatchObject({ code: "invalid_import" });
  });

  it("reports import conflicts with the service message", async () => {
    const testServer = await createTestServer({
      import: vi
        .fn<(input: unknown) => Promise<unknown>>()
        .mockRejectedValue(new Error("Storage location WH-A references unknown site SITE-WH")),
    } as unknown as CatalogImportService);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/products/imports`, {
      method: "POST",
      headers: { "content-type": "application/json", ...MANAGER },
      body: JSON.stringify({
        schemaVersion: 1,
        storageLocations: [{ siteCode: "SITE-WH", code: "WH-A", name: "A", locationType: "Warehouse" }],
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "import_conflict",
      title: "Storage location WH-A references unknown site SITE-WH",
    });
  });

  it("reports an unavailable database", async () => {
    const testServer = await createTestServer(undefined);
    server = testServer.server;

    const response = await fetch(`${testServer.url}/products/imports`, {
      method: "POST",
      headers: { "content-type": "application/json", ...MANAGER },
      body: JSON.stringify({ schemaVersion: 1, suppliers: [{ code: "SUP", name: "Supplier" }] }),
    });

    expect(response.status).toBe(503);
  });
});
