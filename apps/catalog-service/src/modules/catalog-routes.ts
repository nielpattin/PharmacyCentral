import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import { productMatchRequestSchema, productSearchQuerySchema } from "../contracts/catalog.ts";
import { listSiteIds } from "../middleware/trusted-request.ts";
import { decodePageCursor, encodePageCursor } from "../shared/pagination/page-cursor.ts";

import { ProductMediaStore } from "./catalog/product-media-store.ts";
import { rankCandidates } from "./catalog/product-matching.ts";
import { databaseProductPage, searchCatalogProducts } from "./catalog/search/hybrid-search.ts";
import { decodeCursor, encodeCursor } from "./catalog/search/page-cursor.ts";
import type { ProductSearchIndex } from "./catalog/search/product-search-index.ts";
import { createSearchResponseCache } from "./catalog/search/search-response-cache.ts";
import type { TextEmbedderSource } from "./catalog/search/text-embedder.ts";
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
  indications: z.string().trim().max(4000).nullable().optional(),
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
/**
 * Store locations and stock levels are public reads, so a shopper's `?siteId=` still narrows them to the chosen
 * store; a site-scoped employee gets their own scope from `listSiteIds` instead.
 */
const publicListSiteIds = (request: Request): string[] | undefined => {
  const requested = typeof request.query.siteId === "string" ? request.query.siteId.trim() : "";
  return listSiteIds(request) ?? (requested ? [requested] : undefined);
};
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
  /** Matches the SKU or the name of the product the price belongs to, case-insensitively. */
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});
/** Matches the code or the name of the list's own rows, case-insensitively. */
const searchQuerySchema = z.object({ q: z.string().trim().max(200).optional() });
const cursorQuerySchema = z.object({ cursor: z.string().optional() });
const priceCountQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  status: z.string().trim().max(20).optional(),
  q: z.string().trim().max(200).optional(),
});
const productCountQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
  prescriptionRequired: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
const basePricesQuerySchema = z.object({ day: z.iso.date().optional() });
/** The sort values the keyset lists were ordered by: a price's effective date, a store's code. */
const priceCursorSortValue = z.iso.date();
const storeCursorSortValue = z.string().min(1).max(50);
const activePriceQuerySchema = z.object({
  productId: z.string().uuid(),
  productUnitId: z.string().uuid(),
  effectiveDate: z.string().date(),
});

export const createCatalogRouter = (
  repository: DrizzleStoreRepository | undefined,
  mediaStore?: ProductMediaStore,
  options: {
    search?: { index: ProductSearchIndex; embedders?: TextEmbedderSource | undefined };
    onProductsChanged?: (() => void) | undefined;
    warn?: ((error: unknown) => void) | undefined;
  } = {},
): Router => {
  const router = Router();
  const searchCache = createSearchResponseCache();
  // Whatever changes a product also drops the remembered list answers of this replica.
  const productsChanged = (): void => {
    searchCache.clear();
    options.onProductsChanged?.();
  };

  router.get("/sites", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(response);
    response.json(await repository.listSites(parsed.data.q));
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
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(response);
    response.json(await repository.listStorageLocations(publicListSiteIds(request), parsed.data.q));
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

  router.get("/suppliers", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(response);
    response.json(await repository.listSuppliers(parsed.data.q));
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
    const offset = parsed.data.cursor === undefined ? 0 : decodeCursor(parsed.data.cursor);
    if (offset === undefined) return invalidRequest(response);
    const { search, category, prescriptionRequired, limit } = parsed.data;
    // Case and spacing do not change the answer, so they must not split the cache.
    const normalizedSearch = search?.toLowerCase().replace(/\s+/g, " ");
    const query = { search: normalizedSearch, category, prescriptionRequired, limit, offset };
    const answer = await searchCache.load(JSON.stringify(query), async () => {
      const page = options.search
        ? await searchCatalogProducts(
            {
              repository,
              index: options.search.index,
              embedders: options.search.embedders,
              warn: options.warn,
              onIndexMissing: options.onProductsChanged,
            },
            query,
          )
        : await databaseProductPage(repository, query);
      return {
        body: JSON.stringify(await withUnits(repository, page.products)),
        nextCursor: page.hasMore ? encodeCursor(offset + limit) : undefined,
      };
    });
    // The body stays a plain array; the cursor of the next page travels in a header.
    if (answer.nextCursor !== undefined) response.set("X-Next-Cursor", answer.nextCursor);
    response.type("application/json").send(answer.body);
  });

  // Registered before `/products/:id`, which would otherwise read "count" as a product id.
  router.get("/products/count", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = productCountQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(response);
    response.json({ count: await repository.countProducts(parsed.data) });
  });

  // Answers one entry per requested item, in request order, so a caller can pair each prescription line with its
  // suggestions.
  router.post("/products/match", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = productMatchRequestSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(response);
    const results = await Promise.all(
      parsed.data.items.map(async (item) => {
        const candidates = await repository.matchProducts(item, parsed.data.limit);
        const ranked = rankCandidates(item, candidates, parsed.data.limit);
        const products = await withUnits(
          repository,
          ranked.map((match) => match.product),
        );
        return { matches: ranked.map((match, index) => ({ ...match, product: products[index] })) };
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
      productsChanged();
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
      productsChanged();
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
    productsChanged();
  });

  router.get("/pricing/prices", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = priceQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(response);
    const { cursor, limit, ...filters } = parsed.data;
    const after = cursor === undefined ? undefined : decodePageCursor(cursor, priceCursorSortValue);
    if (cursor !== undefined && after === undefined) return invalidCursor(response);
    const page = await repository.listPrices({ ...filters, after, limit });
    const last = page.rows.at(-1);
    if (page.hasMore && last) {
      response.set("X-Next-Cursor", encodePageCursor({ sortValue: last.effectiveFrom, id: last.id }));
    }
    response.json(page.rows);
  });

  // Registered before the price actions, so the literal paths are never read as a price id.
  router.get("/pricing/prices/count", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = priceCountQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(response);
    response.json({ count: await repository.countPrices(parsed.data) });
  });

  // One row per active product with its base-unit price on `day` (today UTC by default), null where none qualifies.
  router.get("/pricing/base-prices", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const parsed = basePricesQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(response);
    const day = parsed.data.day ?? new Date().toISOString().slice(0, 10);
    response.json(await repository.listBasePricesOn(day));
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
    response.json(await repository.listAvailability(productId, publicListSiteIds(request)));
  });

  router.get("/stores", async (request, response) => {
    if (!repository) return databaseUnavailable(response);
    const limit = Number.parseInt(typeof request.query.limit === "string" ? request.query.limit : "50", 10);
    const parsed = cursorQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidCursor(response);
    const after =
      parsed.data.cursor === undefined ? undefined : decodePageCursor(parsed.data.cursor, storeCursorSortValue);
    if (parsed.data.cursor !== undefined && after === undefined) return invalidCursor(response);
    const page = await repository.listActiveStores(Number.isFinite(limit) ? limit : 50, after);
    const last = page.rows.at(-1);
    if (page.hasMore && last) response.set("X-Next-Cursor", encodePageCursor({ sortValue: last.code, id: last.id }));
    response.json(page.rows);
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
/** Attaches the units to every product with one query for the whole list, in the order of `products`. */
const withUnits = async (
  repository: DrizzleStoreRepository,
  products: Array<typeof import("../shared/infrastructure/schema.ts").products.$inferSelect>,
) => {
  const units = await repository.listUnitsByProductIds(products.map((product) => product.id));
  return products.map((product) => ({ ...product, units: units.get(product.id) ?? [] }));
};
const withProductUnits = async (
  repository: DrizzleStoreRepository,
  product: typeof import("../shared/infrastructure/schema.ts").products.$inferSelect,
) => ({ ...product, units: await repository.listProductUnits(product.id) });
const invalidRequest = (response: import("express").Response) =>
  response.status(400).json({ title: "Invalid request", status: 400, code: "invalid_request" });
const invalidCursor = (response: Response) =>
  response.status(400).json({ title: "Invalid cursor", status: 400, code: "invalid_cursor" });
const writeError = (response: import("express").Response, error: unknown) =>
  response
    .status(409)
    .json({ title: error instanceof Error ? error.message : "Catalog write failed", status: 409, code: "conflict" });
