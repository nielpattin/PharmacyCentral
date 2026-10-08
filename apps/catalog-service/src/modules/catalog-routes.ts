import { Router } from "express";
import { z } from "zod";

import { productMatchRequestSchema, productSearchQuerySchema } from "../contracts/catalog.ts";

import { ProductMediaStore } from "./catalog/product-media-store.ts";
import { rankCandidates } from "./catalog/product-matching.ts";
import type { DrizzleStoreRepository } from "./stores/infrastructure/drizzle-store-repository.ts";

const idParamSchema = z.object({ id: z.string().uuid() });
const siteInputSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  siteType: z.string().trim().min(1).max(50),
  status: z.string().trim().max(30).optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  isCustomerFacing: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});
const productInputSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  barcode: z.string().trim().max(100).nullable().optional(),
  name: z.string().trim().min(1).max(300),
  genericName: z.string().trim().max(300).nullable().optional(),
  activeIngredient: z.string().trim().max(2000).nullable().optional(),
  strength: z.string().trim().max(150).nullable().optional(),
  dosageForm: z.string().trim().max(150).nullable().optional(),
  packageDescription: z.string().trim().max(500).nullable().optional(),
  registrationNumber: z.string().trim().max(100).nullable().optional(),
  prescriptionRequired: z.boolean().optional(),
  imageUrl: z.string().url().nullable().optional(),
  category: z.string().trim().max(150).nullable().optional(),
  manufacturer: z.string().trim().max(300).nullable().optional(),
  status: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  units: z
    .array(
      z.object({
        id: z.string().uuid().nullable().optional(),
        unitName: z.string().trim().min(1).max(100),
        conversionFactorToBaseUnit: z.coerce.number().positive(),
        isBaseUnit: z.boolean().optional(),
        isDefaultSaleUnit: z.boolean().optional(),
        isDefaultPurchaseUnit: z.boolean().optional(),
        barcode: z.string().trim().max(100).nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .optional(),
});
const storageLocationInputSchema = z.object({
  siteId: z.string().uuid(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  locationType: z.string().trim().min(1).max(50),
  status: z.string().trim().max(30).optional(),
  capacity: z.number().nonnegative().nullable().optional(),
  isActive: z.boolean().optional(),
});
const supplierInputSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(300),
  contactName: z.string().trim().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  address: z.string().trim().max(2000).nullable().optional(),
  status: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});
const productUnitInputSchema = z.object({
  productId: z.string().uuid(),
  unitName: z.string().trim().min(1).max(100),
  conversionFactorToBaseUnit: z.coerce.number().positive(),
  isBaseUnit: z.boolean().optional(),
  isDefaultSaleUnit: z.boolean().optional(),
  isDefaultPurchaseUnit: z.boolean().optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  sortOrder: z.number().int().optional(),
});
const priceInputSchema = z.object({
  productId: z.string().uuid(),
  productUnitId: z.string().uuid(),
  siteId: z.null().optional(),
  unitPrice: z.coerce.number().positive(),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const priceQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  status: z.string().trim().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const activePriceQuerySchema = z.object({
  productId: z.string().uuid(),
  productUnitId: z.string().uuid(),
  effectiveDate: z.string().date(),
});

export const createCatalogRouter = (
  repository: DrizzleStoreRepository | undefined,
  mediaStore?: ProductMediaStore,
): Router => {
  const router = Router();

  router.get("/sites", async (_request, response) => {
    if (!repository) return databaseUnavailable(response);
    response.json(await repository.listSites());
  });

  router.get("/sites/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return invalidRequest(response);
    const site = await repository.getSite(id.data.id);
    if (!site) return response.status(404).json({ title: "Site not found", status: 404 });
    response.json(site);
  });

  router.post("/sites", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = siteInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(response);
    try {
      response.status(201).json(await repository.createSite(parsed.data));
    } catch (error) {
      writeError(response, error);
    }
  });

  router.put("/sites/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    const parsed = siteInputSchema.partial().safeParse(request.body);
    if (!id.success || !parsed.success) return invalidRequest(response);
    try {
      const site = await repository.updateSite(id.data.id, parsed.data);
      if (!site) return response.status(404).json({ title: "Site not found", status: 404 });
      response.json(site);
    } catch (error) {
      writeError(response, error);
    }
  });

  router.delete("/sites/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return invalidRequest(response);
    await repository.deleteSite(id.data.id);
    response.status(204).end();
  });

  router.get("/storage-locations", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const siteId = typeof request.query.siteId === "string" ? request.query.siteId : undefined;
    response.json(await repository.listStorageLocations(siteId));
  });

  router.get("/storage-locations/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return invalidRequest(response);
    const location = await repository.getStorageLocation(id.data.id);
    if (!location) return response.status(404).json({ title: "Storage location not found", status: 404 });
    response.json(location);
  });

  router.post("/storage-locations", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = storageLocationInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(response);
    try {
      response.status(201).json(await repository.createStorageLocation(parsed.data));
    } catch (error) {
      writeError(response, error);
    }
  });

  router.put("/storage-locations/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    const parsed = storageLocationInputSchema.omit({ siteId: true }).partial().safeParse(request.body);
    if (!id.success || !parsed.success) return invalidRequest(response);
    try {
      const location = await repository.updateStorageLocation(id.data.id, parsed.data);
      if (!location) return response.status(404).json({ title: "Storage location not found", status: 404 });
      response.json(location);
    } catch (error) {
      writeError(response, error);
    }
  });

  router.delete("/storage-locations/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return invalidRequest(response);
    await repository.deleteStorageLocation(id.data.id);
    response.status(204).end();
  });

  router.get("/suppliers", async (_request, response) => {
    if (!repository) return databaseUnavailable(response);
    response.json(await repository.listSuppliers());
  });

  router.get("/suppliers/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return invalidRequest(response);
    const supplier = await repository.getSupplier(id.data.id);
    if (!supplier) return response.status(404).json({ title: "Supplier not found", status: 404 });
    response.json(supplier);
  });

  router.post("/suppliers", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = supplierInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(response);
    try {
      response.status(201).json(await repository.createSupplier(parsed.data));
    } catch (error) {
      writeError(response, error);
    }
  });

  router.put("/suppliers/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    const parsed = supplierInputSchema.partial().safeParse(request.body);
    if (!id.success || !parsed.success) return invalidRequest(response);
    try {
      const supplier = await repository.updateSupplier(id.data.id, parsed.data);
      if (!supplier) return response.status(404).json({ title: "Supplier not found", status: 404 });
      response.json(supplier);
    } catch (error) {
      writeError(response, error);
    }
  });

  router.delete("/suppliers/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return invalidRequest(response);
    await repository.deleteSupplier(id.data.id);
    response.status(204).end();
  });

  router.get("/products", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = productSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(response);
    const products = await repository.searchProducts(parsed.data.search, parsed.data.limit, parsed.data.category);
    response.json(await Promise.all(products.map((product) => withProductUnits(repository, product))));
  });

  // Answers one entry per requested item, in request order, so a caller can pair each prescription line with its suggestions.
  router.post("/products/match", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = productMatchRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(response);
    const results = await Promise.all(
      parsed.data.items.map(async (item) => {
        const candidates = await repository.matchProducts(item, parsed.data.limit);
        const ranked = rankCandidates(item, candidates, parsed.data.limit);
        return {
          matches: await Promise.all(
            ranked.map(async (match) => ({ ...match, product: await withProductUnits(repository, match.product) })),
          ),
        };
      }),
    );
    response.json(results);
  });

  router.get("/products/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return invalidRequest(response);
    const product = await repository.getProduct(id.data.id);
    if (!product) return response.status(404).json({ title: "Product not found", status: 404 });
    response.json(await withProductUnits(repository, product));
  });

  router.put("/products/:id/image", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    if (!mediaStore)
      return response.status(503).json({ title: "Product media storage is not configured", status: 503 });
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return invalidRequest(response);
    if (!Buffer.isBuffer(request.body)) return invalidRequest(response);
    try {
      if (!(await repository.getProduct(id.data.id))) {
        return response.status(404).json({ title: "Product not found", status: 404 });
      }
      const stored = await mediaStore.store(id.data.id, request.body);
      const product = await repository.updateProduct(id.data.id, { imageUrl: stored.imageUrl });
      if (!product) return response.status(404).json({ title: "Product not found", status: 404 });
      response.json({ ...product, media: stored });
    } catch (error) {
      response.status(400).json({
        title: error instanceof Error ? error.message : "Product image upload failed",
        status: 400,
        code: "invalid_product_image",
      });
    }
  });

  router.get("/products/:id/units", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return invalidRequest(response);
    response.json(await repository.listProductUnits(id.data.id));
  });

  router.post("/products/:id/units", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    const parsed = productUnitInputSchema.omit({ productId: true }).safeParse(request.body);
    if (!id.success || !parsed.success) return invalidRequest(response);
    try {
      response.status(201).json(
        await repository.createProductUnit({
          ...parsed.data,
          productId: id.data.id,
          conversionFactorToBaseUnit: String(parsed.data.conversionFactorToBaseUnit),
        }),
      );
    } catch (error) {
      writeError(response, error);
    }
  });

  router.put("/products/:productId/units/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const ids = z.object({ productId: z.string().uuid(), id: z.string().uuid() }).safeParse(request.params);
    const parsed = productUnitInputSchema.omit({ productId: true }).partial().safeParse(request.body);
    if (!ids.success || !parsed.success) return invalidRequest(response);
    try {
      const unit = await repository.updateProductUnit(ids.data.id, parsed.data);
      if (!unit) return response.status(404).json({ title: "Product unit not found", status: 404 });
      response.json(unit);
    } catch (error) {
      writeError(response, error);
    }
  });

  router.delete("/products/:productId/units/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const ids = z.object({ productId: z.string().uuid(), id: z.string().uuid() }).safeParse(request.params);
    if (!ids.success) return invalidRequest(response);
    await repository.deleteProductUnit(ids.data.id);
    response.status(204).end();
  });

  router.post("/products", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = productInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(response);
    try {
      const { units, ...productInput } = parsed.data;
      const created = await repository.createProduct(productInput);
      const savedUnits = units
        ? await Promise.all(
            units.map((unit) =>
              repository.createProductUnit({
                ...unit,
                productId: created.id,
                id: undefined,
                conversionFactorToBaseUnit: String(unit.conversionFactorToBaseUnit),
              }),
            ),
          )
        : [];
      response.status(201).json({ ...created, units: savedUnits });
    } catch (error) {
      writeError(response, error);
    }
  });

  router.put("/products/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    const parsed = productInputSchema.partial().safeParse(request.body);
    if (!id.success || !parsed.success) return invalidRequest(response);
    try {
      const { units, ...productInput } = parsed.data;
      const product = await repository.updateProduct(id.data.id, productInput);
      if (!product) return response.status(404).json({ title: "Product not found", status: 404 });
      const savedUnits = units
        ? await Promise.all(
            units.map((unit) =>
              unit.id
                ? repository.updateProductUnit(unit.id, unit)
                : repository.createProductUnit({
                    ...unit,
                    productId: id.data.id,
                    id: undefined,
                    conversionFactorToBaseUnit: String(unit.conversionFactorToBaseUnit),
                  }),
            ),
          )
        : await repository.listProductUnits(id.data.id);
      response.json({ ...product, units: savedUnits });
    } catch (error) {
      writeError(response, error);
    }
  });

  router.delete("/products/:id", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return invalidRequest(response);
    await repository.deleteProduct(id.data.id);
    response.status(204).end();
  });

  router.get("/pricing/prices", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = priceQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(response);
    response.json(await repository.listPrices(parsed.data));
  });

  router.get("/pricing/active", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = activePriceQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(response);
    const price = await repository.getActivePrice(
      parsed.data.productId,
      parsed.data.productUnitId,
      parsed.data.effectiveDate,
    );
    if (!price) return response.status(404).json({ title: "Active price not found", status: 404 });
    response.json(price);
  });

  router.post("/pricing/prices", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = priceInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(response);
    try {
      response.status(201).json(
        await repository.createPrice({
          ...parsed.data,
          currency: parsed.data.currency.toUpperCase(),
          unitPrice: String(parsed.data.unitPrice),
          createdBy: request.header("X-Actor-Id") ?? null,
        }),
      );
    } catch (error) {
      writeError(response, error);
    }
  });

  router.post("/pricing/prices/:id/:action", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const id = idParamSchema.safeParse(request.params);
    const action = z.enum(["publish", "archive"]).safeParse(request.params.action);
    const body = z.object({ notes: z.string().trim().max(2000).optional() }).safeParse(request.body);
    if (!id.success || !action.success || !body.success) return invalidRequest(response);
    try {
      const price = await repository.transitionPrice(
        id.data.id,
        action.data,
        request.header("X-Actor-Id") ?? undefined,
        body.data.notes,
      );
      if (!price) return response.status(404).json({ title: "Price not found", status: 404 });
      response.json(price);
    } catch (error) {
      writeError(response, error);
    }
  });

  router.get("/availability", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const productId = typeof request.query.productId === "string" ? request.query.productId : undefined;
    const siteId = typeof request.query.siteId === "string" ? request.query.siteId : undefined;
    response.json(await repository.listAvailability(productId, siteId));
  });

  router.get("/stores", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const limit = Number.parseInt(typeof request.query.limit === "string" ? request.query.limit : "50", 10);
    response.json(await repository.listActiveStores(Number.isFinite(limit) ? limit : 50));
  });

  router.get("/stores/nearest", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const latitude = Number(request.query.latitude);
    const longitude = Number(request.query.longitude);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return response.status(400).json({ title: "Invalid coordinates", status: 400, code: "invalid_coordinates" });
    }
    const limit = Number.parseInt(typeof request.query.limit === "string" ? request.query.limit : "5", 10);
    response.json(await repository.findNearestStores({ latitude, longitude }, Number.isFinite(limit) ? limit : 5));
  });

  return router;
};

const databaseUnavailable = (response: import("express").Response) =>
  response.status(503).json({ title: "Catalog database is not configured", status: 503 });
const withProductUnits = async (
  repository: DrizzleStoreRepository,
  product: typeof import("../shared/infrastructure/schema.ts").products.$inferSelect,
) => ({ ...product, units: await repository.listProductUnits(product.id) });
const invalidRequest = (response: import("express").Response) =>
  response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
const writeError = (response: import("express").Response, error: unknown) =>
  response
    .status(409)
    .json({ title: error instanceof Error ? error.message : "Catalog write failed", status: 409, code: "conflict" });
