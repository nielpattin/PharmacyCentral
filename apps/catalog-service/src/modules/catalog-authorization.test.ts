import express from "express";
import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTrustedRequestMiddleware, matchesPathPrefix } from "../middleware/trusted-request.ts";
import { bearerHeaders, testVerifier } from "../test-support/access-tokens.ts";
import { REFUSALS, RefusalError } from "../shared/refusal.ts";
import { createCatalogRouter } from "./catalog-routes.ts";
import type { DrizzleStoreRepository } from "./stores/infrastructure/drizzle-store-repository.ts";

const PUBLIC_CATALOG_PATHS = ["/products", "/pricing/active", "/pricing/prices", "/stores", "/availability"];

const SITE_A = "00000000-0000-4000-8000-00000000000a";
const SITE_B = "00000000-0000-4000-8000-00000000000b";
const LOCATION_B = "00000000-0000-4000-8000-00000000001b";
const PRODUCT = "00000000-0000-4000-8000-000000000002";
const PRICE = "00000000-0000-4000-8000-0000000000a1";
const SUPPLIER = "00000000-0000-4000-8000-000000000004";
const MANAGER_ID = "66666666-6666-4666-8666-666666666666";

type Role = "Pharmacist" | "Pharmacy Manager" | "Platform Admin" | "Warehouse Staff";

const employee = (roles: Role[], siteIds: string[], actorId = MANAGER_ID): Promise<Record<string, string>> =>
  bearerHeaders({ actorType: "employee", actorId, roles, siteIds });

const customer = (): Promise<Record<string, string>> =>
  bearerHeaders({ actorType: "customer", actorId: "11111111-1111-4111-8111-111111111111" });

/** A repository whose records all sit at SITE_A, with every method the routes under test call. */
const fakeRepository = () => {
  const repository = {
    listSites: vi.fn(async () => []),
    getSite: vi.fn(async (id: string) => ({ id, code: "SITE", name: "Site" })),
    createSite: vi.fn(async () => ({ id: SITE_A })),
    updateSite: vi.fn(async () => ({ id: SITE_A })),
    deleteSite: vi.fn(async () => "deleted"),
    listStorageLocations: vi.fn(async () => []),
    listSuppliers: vi.fn(async () => []),
    getStorageLocation: vi.fn(async (id: string) => ({ id, siteId: SITE_A, code: "LOC" })),
    createStorageLocation: vi.fn(async () => ({ id: LOCATION_B })),
    updateStorageLocation: vi.fn(async () => ({ id: LOCATION_B, siteId: SITE_A })),
    deleteStorageLocation: vi.fn(async () => "deleted"),
    createSupplier: vi.fn(async () => ({ id: SUPPLIER })),
    updateSupplier: vi.fn(async () => ({ id: SUPPLIER })),
    deleteSupplier: vi.fn(async () => "deleted"),
    createProduct: vi.fn(async () => ({ id: PRODUCT })),
    getProduct: vi.fn(async () => ({ id: PRODUCT })),
    updateProduct: vi.fn(async () => ({ id: PRODUCT })),
    listProductUnits: vi.fn(async () => []),
    deleteProduct: vi.fn(async () => "deleted"),
    createPrice: vi.fn(async () => ({ id: PRICE })),
    transitionPrice: vi.fn(async () => ({ id: PRICE, status: "Published" })),
  };
  return repository;
};

describe("catalog authorization", () => {
  let server: Server | undefined;
  let repository = fakeRepository();

  beforeEach(() => {
    repository = fakeRepository();
  });

  afterEach(async () => {
    if (server) {
      const running = server;
      await new Promise<void>((resolve, reject) => running.close((error) => (error ? reject(error) : resolve())));
    }
    server = undefined;
  });

  const start = async (): Promise<string> => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(
      createTrustedRequestMiddleware({
        verifier: testVerifier,
        isPublic: (request) =>
          ["GET", "HEAD"].includes(request.method) &&
          PUBLIC_CATALOG_PATHS.some((prefix) => matchesPathPrefix(request.path, prefix)),
      }),
    );
    app.use(
      createCatalogRouter(repository as unknown as DrizzleStoreRepository, undefined, {
        verifier: testVerifier,
      }),
    );
    server = createServer(app);
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a port");
    return `http://127.0.0.1:${address.port}`;
  };

  const call = async (
    base: string,
    method: string,
    path: string,
    headersInit: Record<string, string> | Promise<Record<string, string>>,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> | undefined }> => {
    const headers = await headersInit;
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, json: text === "" ? undefined : (JSON.parse(text) as Record<string, unknown>) };
  };

  const siteBody = { code: "SITE-NEW", name: "New site", siteType: "RetailStore" };
  const locationBody = { siteId: SITE_A, code: "LOC-NEW", name: "New location", locationType: "Warehouse" };
  const supplierBody = { code: "SUP-NEW", name: "New supplier" };
  const productBody = { sku: "SKU-NEW", name: "New product" };
  const priceBody = {
    productId: PRODUCT,
    productUnitId: LOCATION_B,
    unitPrice: 12000,
    currency: "VND",
    effectiveFrom: "2026-01-01",
  };

  describe("role matrix at the service", () => {
    // Each write route with the role rule it needs. Platform Admin writes only on the admin rules; every other role is refused the rules it does not hold.
    const writes: Array<{ name: string; method: string; path: string; body?: unknown; rule: "admin" | "manager" }> = [
      { name: "create a site", method: "POST", path: "/sites", body: siteBody, rule: "admin" },
      { name: "delete a site", method: "DELETE", path: `/sites/${SITE_A}`, rule: "admin" },
      { name: "edit a site", method: "PUT", path: `/sites/${SITE_A}`, body: { name: "Renamed" }, rule: "admin" },
      { name: "create a location", method: "POST", path: "/storage-locations", body: locationBody, rule: "admin" },
      {
        name: "edit a location",
        method: "PUT",
        path: `/storage-locations/${LOCATION_B}`,
        body: { name: "x" },
        rule: "admin",
      },
      { name: "delete a location", method: "DELETE", path: `/storage-locations/${LOCATION_B}`, rule: "admin" },
      { name: "create a supplier", method: "POST", path: "/suppliers", body: supplierBody, rule: "admin" },
      { name: "delete a supplier", method: "DELETE", path: `/suppliers/${SUPPLIER}`, rule: "admin" },
      { name: "create a product", method: "POST", path: "/products", body: productBody, rule: "manager" },
      { name: "delete a product", method: "DELETE", path: `/products/${PRODUCT}`, rule: "manager" },
      { name: "create a price draft", method: "POST", path: "/pricing/prices", body: priceBody, rule: "manager" },
      { name: "publish a price", method: "POST", path: `/pricing/prices/${PRICE}/publish`, body: {}, rule: "manager" },
    ];

    it("answers 401 to an anonymous caller and 403 employee_required to a shopper on every write", async () => {
      const base = await start();
      for (const write of writes) {
        const anonymous = await call(base, write.method, write.path, {}, write.body);
        const shopper = await call(base, write.method, write.path, customer(), write.body);
        expect(anonymous.status, write.name).toBe(401);
        expect(shopper.status, write.name).toBe(403);
        expect(shopper.json, write.name).toMatchObject({ code: "employee_required" });
      }
    });

    it("refuses Warehouse Staff and Pharmacists every catalog write with 403 role_forbidden", async () => {
      const base = await start();
      for (const write of writes) {
        for (const roles of [["Warehouse Staff"], ["Pharmacist"]] as Role[][]) {
          const result = await call(base, write.method, write.path, employee(roles, [SITE_A]), write.body);
          expect(result.status, `${write.name} as ${roles[0]}`).toBe(403);
          expect(result.json, `${write.name} as ${roles[0]}`).toMatchObject({ code: "role_forbidden" });
        }
      }
    });

    it("refuses a Pharmacy Manager every write to sites, storage locations and suppliers, before any write", async () => {
      const base = await start();
      const manager = employee(["Pharmacy Manager"], [SITE_A]);

      for (const write of writes.filter((candidate) => candidate.rule === "admin")) {
        const result = await call(base, write.method, write.path, manager, write.body);
        expect(result.status, write.name).toBe(403);
        expect(result.json, write.name).toMatchObject({ code: "role_forbidden" });
      }
      expect(repository.createSite).not.toHaveBeenCalled();
      expect(repository.updateSite).not.toHaveBeenCalled();
      expect(repository.deleteSite).not.toHaveBeenCalled();
      expect(repository.createStorageLocation).not.toHaveBeenCalled();
      expect(repository.deleteStorageLocation).not.toHaveBeenCalled();
      expect(repository.createSupplier).not.toHaveBeenCalled();
      expect(repository.deleteSupplier).not.toHaveBeenCalled();
    });

    it("lets Platform Admin through the writes to sites, storage locations and suppliers only, and Pharmacy Manager through the product and price writes", async () => {
      const base = await start();
      for (const write of writes) {
        const admin = await call(base, write.method, write.path, employee(["Platform Admin"], []), write.body);
        if (write.rule === "admin") {
          expect(admin.status, `${write.name} as admin`).not.toBe(403);
          expect(admin.status, `${write.name} as admin`).not.toBe(401);
        } else {
          expect(admin.status, `${write.name} as admin`).toBe(403);
          expect(admin.json, `${write.name} as admin`).toMatchObject({ code: "role_forbidden" });
          const manager = await call(
            base,
            write.method,
            write.path,
            employee(["Pharmacy Manager"], [SITE_A]),
            write.body,
          );
          expect(manager.status, `${write.name} as manager`).not.toBe(403);
          expect(manager.status, `${write.name} as manager`).not.toBe(401);
        }
      }
    });

    it("lets Platform Admin read sites, suppliers and storage locations", async () => {
      const base = await start();
      for (const path of ["/sites", "/suppliers", "/storage-locations"]) {
        const result = await call(base, "GET", path, employee(["Platform Admin"], []));
        expect(result.status, path).toBe(200);
      }
    });

    it("lets any staff role read sites and suppliers, and refuses a shopper or an anonymous caller", async () => {
      const base = await start();

      const warehouseSites = await call(base, "GET", "/sites", employee(["Warehouse Staff"], [SITE_A]));
      const pharmacistSuppliers = await call(base, "GET", "/suppliers", employee(["Pharmacist"], []));
      const shopperSites = await call(base, "GET", "/sites", customer());
      const shopperLocations = await call(base, "GET", "/storage-locations", customer());
      const anonymousSuppliers = await call(base, "GET", "/suppliers", {});

      expect(warehouseSites.status).toBe(200);
      expect(pharmacistSuppliers.status).toBe(200);
      expect(shopperSites.json).toMatchObject({ code: "employee_required" });
      expect(shopperLocations.json).toMatchObject({ code: "employee_required" });
      expect(anonymousSuppliers.status).toBe(401);
    });
  });

  describe("site scope of reads", () => {
    it("refuses a by-id read of a site outside the reader's sites", async () => {
      const base = await start();

      const result = await call(base, "GET", `/sites/${SITE_B}`, employee(["Pharmacist"], [SITE_A]));

      expect(result.json).toMatchObject({ code: "site_access_denied" });
    });

    it("answers a site-scoped reader with no site an empty list, not an error", async () => {
      const base = await start();

      const sites = await call(base, "GET", "/sites", employee(["Pharmacist"], []));
      const locations = await call(base, "GET", "/storage-locations", employee(["Pharmacist"], []));

      expect(sites.status).toBe(200);
      expect(locations.status).toBe(200);
      expect(repository.listSites).toHaveBeenCalledWith(undefined, []);
      expect(repository.listStorageLocations).toHaveBeenCalledWith([], undefined);
    });

    it("narrows a site-scoped reader's site list to their sites", async () => {
      const base = await start();

      await call(base, "GET", "/sites", employee(["Warehouse Staff"], [SITE_A]));

      expect(repository.listSites).toHaveBeenCalledWith(undefined, [SITE_A]);
    });

    it("refuses a site-scoped reader a location list for a site they do not hold", async () => {
      const base = await start();

      const result = await call(base, "GET", `/storage-locations?siteId=${SITE_B}`, employee(["Pharmacist"], [SITE_A]));

      expect(result.json).toMatchObject({ code: "site_access_denied" });
      expect(repository.listStorageLocations).not.toHaveBeenCalled();
    });
  });

  describe("fixed location site and in-use refusals", () => {
    it("answers 400 location_site_fixed when an edit names another site, and writes nothing", async () => {
      const base = await start();
      repository.getStorageLocation.mockResolvedValueOnce({ id: LOCATION_B, siteId: SITE_A, code: "LOC" } as never);

      const result = await call(base, "PUT", `/storage-locations/${LOCATION_B}`, employee(["Platform Admin"], []), {
        siteId: SITE_B,
        name: "Moved",
      });

      expect(result.status).toBe(400);
      expect(result.json).toMatchObject({ code: "location_site_fixed", status: 400 });
      expect(repository.updateStorageLocation).not.toHaveBeenCalled();
    });

    it("accepts an edit that names the location's own site", async () => {
      const base = await start();

      const result = await call(base, "PUT", `/storage-locations/${LOCATION_B}`, employee(["Platform Admin"], []), {
        siteId: SITE_A,
        name: "Same site",
      });

      expect(result.status).toBe(200);
      expect(repository.updateStorageLocation).toHaveBeenCalledWith(LOCATION_B, { name: "Same site" });
    });

    it("answers 409 in_use for a site that the catalog still refers to", async () => {
      const base = await start();
      repository.deleteSite.mockResolvedValueOnce("in_use");

      const result = await call(base, "DELETE", `/sites/${SITE_A}`, employee(["Platform Admin"], []));

      expect(result.status).toBe(409);
      expect(result.json).toMatchObject({ code: "in_use", detail: REFUSALS.siteInUse.detail });
    });

    it("answers 409 in_use for a product that units, prices or availability still refer to", async () => {
      const base = await start();
      repository.deleteProduct.mockResolvedValueOnce("in_use");

      const result = await call(base, "DELETE", `/products/${PRODUCT}`, employee(["Pharmacy Manager"], []));

      expect(result.status).toBe(409);
      expect(result.json).toMatchObject({ code: "in_use", detail: REFUSALS.productInUse.detail });
    });

    it("answers 404 for a delete of a record that does not exist", async () => {
      const base = await start();
      repository.getSite.mockResolvedValueOnce(undefined as never);

      const result = await call(base, "DELETE", `/sites/${SITE_B}`, employee(["Platform Admin"], []));

      expect(result.status).toBe(404);
      expect(repository.deleteSite).not.toHaveBeenCalled();
    });
  });

  describe("price draft publication", () => {
    it("passes the publishing employee to the repository, so the maker check has an actor", async () => {
      const base = await start();

      await call(
        base,
        "POST",
        `/pricing/prices/${PRICE}/publish`,
        employee(["Pharmacy Manager"], [SITE_A], MANAGER_ID),
        {},
      );

      expect(repository.transitionPrice).toHaveBeenCalledWith(PRICE, "publish", MANAGER_ID, undefined);
    });

    it("answers 403 self_approval_forbidden when the repository refuses the creator's own publish", async () => {
      const base = await start();
      repository.transitionPrice.mockRejectedValueOnce(new RefusalError(REFUSALS.priceSelfApproval));

      const result = await call(
        base,
        "POST",
        `/pricing/prices/${PRICE}/publish`,
        employee(["Pharmacy Manager"], [], MANAGER_ID),
        {},
      );

      expect(result.status).toBe(403);
      expect(result.json).toMatchObject({
        code: "self_approval_forbidden",
        detail: "Người tạo bản nháp không được phát hành bản nháp đó.",
      });
    });

    it("records the creator of a new draft from the verified employee", async () => {
      const base = await start();

      await call(base, "POST", "/pricing/prices", employee(["Pharmacy Manager"], [SITE_A], MANAGER_ID), priceBody);

      expect(repository.createPrice).toHaveBeenCalledWith(expect.objectContaining({ createdBy: MANAGER_ID }));
    });
  });
});
