import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { BusinessRuleError } from "../../../shared/business-rule-error.ts";
import { isSelfApproval } from "../../../shared/authorization/policy.ts";
import { REFUSALS, RefusalError } from "../../../shared/refusal.ts";

import {
  INGREDIENT_SIMILARITY_FLOOR,
  NAME_SIMILARITY_FLOOR,
  stripStrengths,
  type MatchCandidate,
  type MatchItem,
} from "../../catalog/product-matching.ts";
import type { CatalogDatabase } from "../../../shared/infrastructure/database.ts";
import {
  availabilityProjections,
  productPrices,
  productUnits,
  products,
  sites,
  storageLocations,
  suppliers,
} from "../../../shared/infrastructure/schema.ts";
import { takeKeysetPage, type KeysetPage, type KeysetPosition } from "../../../shared/pagination/page-cursor.ts";

export type Coordinates = { latitude: number; longitude: number };

/** Escape LIKE wildcards so "%" and "_" in a shopper's query match literally. */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (character) => `\\${character}`);

/** Case-insensitive match of either column, so a search finds a row by its code or its name. Undefined without text. */
const matchesCodeOrName = (code: AnyPgColumn, name: AnyPgColumn, search: string | undefined): SQL | undefined => {
  if (!search) return undefined;
  const pattern = `%${escapeLike(search)}%`;
  return or(ilike(code, pattern), ilike(name, pattern));
};

export type ProductListFilters = {
  search?: string | undefined;
  category?: string | undefined;
  prescriptionRequired?: boolean | undefined;
};

export type PriceListFilters = {
  productId?: string | undefined;
  status?: string | undefined;
  /** Matches the SKU or the name of the product the price belongs to. */
  q?: string | undefined;
};

/** The active products the product list shows for these filters. The list and its count share them. */
const productListFilters = (query: ProductListFilters): SQL[] => {
  const pattern = query.search ? `%${escapeLike(query.search)}%` : undefined;
  return [
    eq(products.isActive, true),
    pattern
      ? or(ilike(products.name, pattern), ilike(products.sku, pattern), ilike(products.barcode, pattern))
      : undefined,
    query.category ? eq(products.category, query.category) : undefined,
    query.prescriptionRequired === undefined
      ? undefined
      : eq(products.prescriptionRequired, query.prescriptionRequired),
  ].filter((filter): filter is NonNullable<typeof filter> => filter !== undefined);
};

/** The price filters the price list and its count share. */
const priceFilters = (input: PriceListFilters): SQL[] => {
  const pattern = input.q ? `%${escapeLike(input.q)}%` : undefined;
  return [
    input.productId ? eq(productPrices.productId, input.productId) : undefined,
    input.status ? eq(productPrices.status, input.status) : undefined,
    pattern
      ? sql`EXISTS (
          SELECT 1 FROM ${products}
          WHERE ${products.id} = ${productPrices.productId}
            AND (${ilike(products.sku, pattern)} OR ${ilike(products.name, pattern)})
        )`
      : undefined,
  ].filter((filter): filter is NonNullable<typeof filter> => filter !== undefined);
};

export type StoreSummary = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  coordinates: Coordinates | null;
};

/**
 * The outcome of a delete. `in_use` is returned only when the catalog's own tables refer to the record; the delete is
 * a single statement that checks those references, so a reference cannot slip in between the check and the delete.
 */
export type DeleteOutcome = "deleted" | "in_use" | "not_found";

export class DrizzleStoreRepository {
  public constructor(private readonly database: CatalogDatabase) {}

  /** One page of the customer-facing stores in code order, continuing after `after` when given. */
  public async listActiveStores(limit = 50, after?: KeysetPosition | undefined): Promise<KeysetPage<StoreSummary>> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    const rows = await this.database.db
      .select({ id: sites.id, code: sites.code, name: sites.name, address: sites.address, location: sites.location })
      .from(sites)
      .where(
        and(
          eq(sites.isActive, true),
          eq(sites.isCustomerFacing, true),
          after ? sql`(${sites.code}, ${sites.id}) > (${after.sortValue}, ${after.id}::uuid)` : undefined,
        ),
      )
      .orderBy(asc(sites.code), asc(sites.id))
      .limit(bounded + 1);

    return takeKeysetPage(
      rows.map((row) => this.toSummary(row)),
      bounded,
    );
  }

  /** One store a shopper can order from, by id; undefined for a site that is inactive or not customer-facing. */
  public async findActiveStore(id: string): Promise<StoreSummary | undefined> {
    const [row] = await this.database.db
      .select({ id: sites.id, code: sites.code, name: sites.name, address: sites.address, location: sites.location })
      .from(sites)
      .where(and(eq(sites.id, id), eq(sites.isActive, true), eq(sites.isCustomerFacing, true)))
      .limit(1);
    return row ? this.toSummary(row) : undefined;
  }

  public async findNearestStores(
    point: Coordinates,
    limit = 5,
  ): Promise<Array<StoreSummary & { straightLineMeters: number }>> {
    const sqlPoint = sql`ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326)`;
    const rows = await this.database.db
      .select({
        id: sites.id,
        code: sites.code,
        name: sites.name,
        address: sites.address,
        location: sites.location,
        straightLineMeters: sql<number>`ST_Distance(${sites.location}::geography, ${sqlPoint}::geography)`,
      })
      .from(sites)
      .where(and(eq(sites.isActive, true), eq(sites.isCustomerFacing, true), sql`${sites.location} IS NOT NULL`))
      .orderBy(sql`${sites.location} <-> ${sqlPoint}`)
      .limit(Math.min(Math.max(limit, 1), 20));

    return rows.map((row) => ({ ...this.toSummary(row), straightLineMeters: Number(row.straightLineMeters) }));
  }

  public async searchProducts(query: {
    search?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    category?: string | undefined;
    prescriptionRequired?: boolean | undefined;
  }): Promise<Array<typeof products.$inferSelect>> {
    // 101 is the largest page plus one row, which lets a caller tell whether another page follows.
    const boundedLimit = Math.min(Math.max(query.limit ?? 20, 1), 101);
    return this.database.db
      .select()
      .from(products)
      .where(and(...productListFilters(query)))
      .orderBy(asc(products.sku))
      .limit(boundedLimit)
      .offset(Math.max(query.offset ?? 0, 0));
  }

  /** How many active products the product list shows for these filters, paging aside. */
  public async countProducts(query: ProductListFilters): Promise<number> {
    const [row] = await this.database.db
      .select({ count: count() })
      .from(products)
      .where(and(...productListFilters(query)));
    return Number(row?.count ?? 0);
  }

  public async listActiveProductsByIds(ids: string[]): Promise<Array<typeof products.$inferSelect>> {
    if (ids.length === 0) return [];
    const rows = await this.database.db
      .select()
      .from(products)
      .where(and(inArray(products.id, ids), eq(products.isActive, true)));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  /**
   * Candidates for one prescription line by trigram similarity on accent-folded text, so "Paracetamol" finds
   * "PARACETAMOL 500MG QUANG BÌNH" and "Amoxicilin" still finds Amoxicillin. The name score is how well the
   * prescribed name sits inside the product name; the ingredient score is the weakest of the prescribed
   * ingredients, because a product holding only one of two ingredients is a different medicine.
   *
   * Every score and every floor is double precision. A line that names no product, or lists no ingredient, scores
   * the constant zero, and an untyped zero next to an untyped bound makes Postgres resolve the fractional floor
   * beside it as integer and reject it with 22P02.
   */
  public async matchProducts(
    item: MatchItem,
    limit: number,
  ): Promise<Array<MatchCandidate<typeof products.$inferSelect>>> {
    const nameQuery = stripStrengths(item.name);
    const ingredientQueries = item.activeIngredients.map(stripStrengths).filter((value) => value.length > 0);
    // A prescription that only names a generic ("Paracetamol 500mg") is also judged against the ingredient columns.
    if (ingredientQueries.length === 0 && nameQuery.length > 0) ingredientQueries.push(nameQuery);
    if (nameQuery.length === 0 && ingredientQueries.length === 0) return [];

    // The GIN trigram indexes are built on catalog_fold, so the comparisons have to fold through the same function.
    const folded = (value: SQL): SQL => sql`catalog_fold(${value})`;
    const text = (query: string): SQL => sql`${query}::text`;
    const doublePrecision = (value: SQL): SQL => sql`(${value})::double precision`;
    const floor = (value: number): SQL => sql`${value}::double precision`;
    const nameScore =
      nameQuery.length > 0
        ? sql`word_similarity(${folded(text(nameQuery))}, ${folded(sql`${products.name}`)})`
        : sql`0`;
    const ingredientScore =
      ingredientQueries.length > 0
        ? sql`LEAST(${sql.join(
            ingredientQueries.map(
              (query) => sql`GREATEST(
                similarity(${folded(sql`coalesce(${products.genericName}, '')`)}, ${folded(text(query))}),
                word_similarity(${folded(text(query))}, ${folded(sql`coalesce(${products.activeIngredient}, '')`)})
              )`,
            ),
            sql`, `,
          )})`
        : sql`0`;

    // `<%` (word similarity) and `%` (similarity) are the only forms of those comparisons a GIN trigram index can
    // answer. They prefilter on the bare folded columns, and the double precision comparisons stay the authority on
    // which rows count, so the operator thresholds never drop a row the floors keep.
    const namePrefilters =
      nameQuery.length > 0 ? [sql`${folded(text(nameQuery))} <% ${folded(sql`${products.name}`)}`] : [];
    const ingredientPrefilters = ingredientQueries.map((query) => {
      const foldedQuery = folded(text(query));
      const foldedGenericName = folded(sql`${products.genericName}`);
      const foldedActiveIngredient = folded(sql`${products.activeIngredient}`);
      return sql`(${foldedGenericName} % ${foldedQuery} OR ${foldedQuery} <% ${foldedActiveIngredient})`;
    });

    const rows = await this.database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(NAME_SIMILARITY_FLOOR)}, true),
                   set_config('pg_trgm.similarity_threshold', ${String(INGREDIENT_SIMILARITY_FLOOR)}, true)`,
      );
      return (
        transaction
          .select({
            product: products,
            nameScore: sql<number>`${nameScore}`,
            ingredientScore: sql<number>`${ingredientScore}`,
          })
          .from(products)
          .where(
            and(
              eq(products.isActive, true),
              or(
                and(sql`${doublePrecision(nameScore)} >= ${floor(NAME_SIMILARITY_FLOOR)}`, ...namePrefilters),
                and(
                  sql`${doublePrecision(ingredientScore)} >= ${floor(INGREDIENT_SIMILARITY_FLOOR)}`,
                  ...ingredientPrefilters,
                ),
              ),
            ),
          )
          .orderBy(desc(sql`GREATEST(${nameScore}, ${ingredientScore})`), asc(products.sku))
          // Strengths reorder the survivors afterwards, so the exact tablet must not be cut off by its siblings.
          .limit(Math.min(Math.max(limit, 1) * 4, 40))
      );
    });
    return rows.map((row) => ({
      product: row.product,
      nameScore: Number(row.nameScore),
      ingredientScore: Number(row.ingredientScore),
    }));
  }

  public async listProductUnits(productId: string): Promise<Array<typeof productUnits.$inferSelect>> {
    return this.database.db
      .select()
      .from(productUnits)
      .where(eq(productUnits.productId, productId))
      .orderBy(asc(productUnits.sortOrder));
  }

  /**
   * The units of many products in one query, each list in sort order. A product without units maps to an empty list.
   * Listing a page of results by calling `listProductUnits` per product costs one round trip per result.
   */
  public async listUnitsByProductIds(
    productIds: readonly string[],
  ): Promise<Map<string, Array<typeof productUnits.$inferSelect>>> {
    const byProduct = new Map<string, Array<typeof productUnits.$inferSelect>>(productIds.map((id) => [id, []]));
    if (productIds.length === 0) return byProduct;
    const rows = await this.database.db
      .select()
      .from(productUnits)
      .where(inArray(productUnits.productId, [...productIds]))
      .orderBy(asc(productUnits.sortOrder));
    for (const row of rows) byProduct.get(row.productId)?.push(row);
    return byProduct;
  }

  public async createProductUnit(input: typeof productUnits.$inferInsert): Promise<typeof productUnits.$inferSelect> {
    const [unit] = await this.database.db.insert(productUnits).values(input).returning();
    if (!unit) throw new Error("Product unit insert did not return a row");
    return unit;
  }

  public async updateProductUnit(
    id: string,
    input: {
      unitName?: string | undefined;
      conversionFactorToBaseUnit?: string | number | undefined;
      isBaseUnit?: boolean | undefined;
      isDefaultSaleUnit?: boolean | undefined;
      isDefaultPurchaseUnit?: boolean | undefined;
      barcode?: string | null | undefined;
      sortOrder?: number | undefined;
    },
  ): Promise<typeof productUnits.$inferSelect | undefined> {
    const [unit] = await this.database.db
      .update(productUnits)
      .set({
        ...(input.unitName === undefined ? {} : { unitName: input.unitName }),
        ...(input.conversionFactorToBaseUnit === undefined
          ? {}
          : { conversionFactorToBaseUnit: String(input.conversionFactorToBaseUnit) }),
        ...(input.isBaseUnit === undefined ? {} : { isBaseUnit: input.isBaseUnit }),
        ...(input.isDefaultSaleUnit === undefined ? {} : { isDefaultSaleUnit: input.isDefaultSaleUnit }),
        ...(input.isDefaultPurchaseUnit === undefined ? {} : { isDefaultPurchaseUnit: input.isDefaultPurchaseUnit }),
        ...(input.barcode === undefined ? {} : { barcode: input.barcode }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      })
      .where(eq(productUnits.id, id))
      .returning();
    return unit;
  }

  public async deleteProductUnit(id: string): Promise<void> {
    await this.database.db.delete(productUnits).where(eq(productUnits.id, id));
  }

  public async listAvailability(
    productId?: string,
    siteIds?: string[],
  ): Promise<Array<typeof availabilityProjections.$inferSelect>> {
    const filters = [
      productId ? eq(availabilityProjections.productId, productId) : undefined,
      siteIds ? inArray(availabilityProjections.siteId, siteIds) : undefined,
    ].filter((filter): filter is NonNullable<typeof filter> => filter !== undefined);
    return this.database.db
      .select()
      .from(availabilityProjections)
      .where(filters.length ? and(...filters) : undefined);
  }

  /** The sites matching `search`, limited to `siteIds` when given. An empty `siteIds` matches nothing. */
  public async listSites(
    search?: string | undefined,
    siteIds?: readonly string[] | undefined,
  ): Promise<Array<typeof sites.$inferSelect>> {
    return this.database.db
      .select()
      .from(sites)
      .where(
        and(siteIds ? inArray(sites.id, [...siteIds]) : undefined, matchesCodeOrName(sites.code, sites.name, search)),
      )
      .orderBy(asc(sites.code));
  }

  public async getSite(id: string): Promise<typeof sites.$inferSelect | undefined> {
    return (await this.database.db.select().from(sites).where(eq(sites.id, id)).limit(1))[0];
  }

  public async createSite(input: {
    code: string;
    name: string;
    siteType: string;
    status?: string | undefined;
    address?: string | null | undefined;
    notes?: string | null | undefined;
    isActive?: boolean | undefined;
    isCustomerFacing?: boolean | undefined;
    latitude?: number | null | undefined;
    longitude?: number | null | undefined;
  }): Promise<typeof sites.$inferSelect> {
    const location =
      input.latitude !== null &&
      input.latitude !== undefined &&
      input.longitude !== null &&
      input.longitude !== undefined
        ? { x: input.longitude, y: input.latitude }
        : null;
    const [site] = await this.database.db
      .insert(sites)
      .values({
        code: input.code.trim(),
        name: input.name.trim(),
        siteType: input.siteType.trim(),
        status: input.status ?? "Active",
        address: input.address ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
        isCustomerFacing: input.isCustomerFacing ?? false,
        location,
      })
      .returning();
    if (!site) {
      throw new Error("Site insert did not return a row");
    }
    return site;
  }

  public async updateSite(
    id: string,
    input: {
      code?: string | undefined;
      name?: string | undefined;
      siteType?: string | undefined;
      status?: string | undefined;
      address?: string | null | undefined;
      notes?: string | null | undefined;
      isActive?: boolean | undefined;
      isCustomerFacing?: boolean | undefined;
      latitude?: number | null | undefined;
      longitude?: number | null | undefined;
    },
  ): Promise<typeof sites.$inferSelect | undefined> {
    const values: Partial<typeof sites.$inferInsert> = {
      ...(input.code === undefined ? {} : { code: input.code.trim() }),
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.siteType === undefined ? {} : { siteType: input.siteType.trim() }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.address === undefined ? {} : { address: input.address }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.isCustomerFacing === undefined ? {} : { isCustomerFacing: input.isCustomerFacing }),
      ...(input.latitude === undefined || input.longitude === undefined
        ? {}
        : {
            location:
              input.latitude === null || input.longitude === null ? null : { x: input.longitude, y: input.latitude },
          }),
      updatedAt: new Date(),
    };
    const [site] = await this.database.db.update(sites).set(values).where(eq(sites.id, id)).returning();
    return site;
  }

  /**
   * Deletes a site unless a storage location or an availability row of the catalog refers to it. The catalog keeps no
   * foreign keys, so the check is part of the delete statement itself.
   */
  public async deleteSite(id: string): Promise<DeleteOutcome> {
    const deleted = await this.database.db
      .delete(sites)
      .where(
        and(
          eq(sites.id, id),
          sql`NOT EXISTS (SELECT 1 FROM ${storageLocations} WHERE ${storageLocations.siteId} = ${sites.id})`,
          sql`NOT EXISTS (SELECT 1 FROM ${availabilityProjections} WHERE ${availabilityProjections.siteId} = ${sites.id})`,
        ),
      )
      .returning({ id: sites.id });
    if (deleted.length > 0) return "deleted";
    return (await this.getSite(id)) ? "in_use" : "not_found";
  }

  public async listStorageLocations(
    siteIds?: string[],
    search?: string | undefined,
  ): Promise<Array<typeof storageLocations.$inferSelect>> {
    return this.database.db
      .select()
      .from(storageLocations)
      .where(
        and(
          siteIds ? inArray(storageLocations.siteId, siteIds) : undefined,
          matchesCodeOrName(storageLocations.code, storageLocations.name, search),
        ),
      )
      .orderBy(asc(storageLocations.code));
  }

  public async getStorageLocation(id: string): Promise<typeof storageLocations.$inferSelect | undefined> {
    return (await this.database.db.select().from(storageLocations).where(eq(storageLocations.id, id)).limit(1))[0];
  }

  public async createStorageLocation(input: {
    siteId: string;
    code: string;
    name: string;
    locationType: string;
    status?: string | undefined;
    capacity?: number | null | undefined;
    isActive?: boolean | undefined;
  }): Promise<typeof storageLocations.$inferSelect> {
    const [location] = await this.database.db
      .insert(storageLocations)
      .values({
        siteId: input.siteId,
        code: input.code.trim(),
        name: input.name.trim(),
        locationType: input.locationType.trim(),
        status: input.status ?? "Active",
        capacity: input.capacity === null || input.capacity === undefined ? null : String(input.capacity),
        isActive: input.isActive ?? true,
      })
      .returning();
    if (!location) throw new Error("Storage location insert did not return a row");
    return location;
  }

  public async updateStorageLocation(
    id: string,
    input: {
      code?: string | undefined;
      name?: string | undefined;
      locationType?: string | undefined;
      status?: string | undefined;
      capacity?: number | null | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<typeof storageLocations.$inferSelect | undefined> {
    const [location] = await this.database.db
      .update(storageLocations)
      .set({
        ...(input.code === undefined ? {} : { code: input.code.trim() }),
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.locationType === undefined ? {} : { locationType: input.locationType.trim() }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.capacity === undefined ? {} : { capacity: input.capacity === null ? null : String(input.capacity) }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(storageLocations.id, id))
      .returning();
    return location;
  }

  /**
   * The catalog's own tables hold no reference to a storage location; stock lives in inventory-service, which the
   * catalog cannot see, so this delete is not refused for use.
   */
  public async deleteStorageLocation(id: string): Promise<"deleted" | "not_found"> {
    const deleted = await this.database.db
      .delete(storageLocations)
      .where(eq(storageLocations.id, id))
      .returning({ id: storageLocations.id });
    return deleted.length > 0 ? "deleted" : "not_found";
  }

  public async listSuppliers(search?: string | undefined): Promise<Array<typeof suppliers.$inferSelect>> {
    return this.database.db
      .select()
      .from(suppliers)
      .where(matchesCodeOrName(suppliers.code, suppliers.name, search))
      .orderBy(asc(suppliers.code));
  }

  public async getSupplier(id: string): Promise<typeof suppliers.$inferSelect | undefined> {
    return (await this.database.db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1))[0];
  }

  public async createSupplier(input: {
    code: string;
    name: string;
    contactName?: string | null | undefined;
    email?: string | null | undefined;
    phone?: string | null | undefined;
    address?: string | null | undefined;
    status?: string | undefined;
    notes?: string | null | undefined;
    isActive?: boolean | undefined;
  }): Promise<typeof suppliers.$inferSelect> {
    const [supplier] = await this.database.db
      .insert(suppliers)
      .values({
        code: input.code.trim(),
        name: input.name.trim(),
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        status: input.status ?? "Active",
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
      })
      .returning();
    if (!supplier) throw new Error("Supplier insert did not return a row");
    return supplier;
  }

  public async updateSupplier(
    id: string,
    input: {
      code?: string | undefined;
      name?: string | undefined;
      contactName?: string | null | undefined;
      email?: string | null | undefined;
      phone?: string | null | undefined;
      address?: string | null | undefined;
      status?: string | undefined;
      notes?: string | null | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<typeof suppliers.$inferSelect | undefined> {
    const [supplier] = await this.database.db.update(suppliers).set(input).where(eq(suppliers.id, id)).returning();
    return supplier;
  }

  /**
   * The catalog's own tables hold no reference to a supplier; purchase orders live in inventory-service, which the
   * catalog cannot see, so this delete is not refused for use.
   */
  public async deleteSupplier(id: string): Promise<"deleted" | "not_found"> {
    const deleted = await this.database.db
      .delete(suppliers)
      .where(eq(suppliers.id, id))
      .returning({ id: suppliers.id });
    return deleted.length > 0 ? "deleted" : "not_found";
  }

  public async createProduct(input: {
    sku: string;
    barcode?: string | null | undefined;
    name: string;
    genericName?: string | null | undefined;
    activeIngredient?: string | null | undefined;
    indications?: string | null | undefined;
    strength?: string | null | undefined;
    dosageForm?: string | null | undefined;
    packageDescription?: string | null | undefined;
    registrationNumber?: string | null | undefined;
    prescriptionRequired?: boolean | undefined;
    imageUrl?: string | null | undefined;
    category?: string | null | undefined;
    manufacturer?: string | null | undefined;
    status?: string | undefined;
    notes?: string | null | undefined;
    isActive?: boolean | undefined;
  }): Promise<typeof products.$inferSelect> {
    const [product] = await this.database.db
      .insert(products)
      .values({
        sku: input.sku.trim(),
        barcode: input.barcode?.trim() || null,
        name: input.name.trim(),
        genericName: input.genericName?.trim() ?? null,
        activeIngredient: input.activeIngredient?.trim() ?? null,
        indications: input.indications?.trim() ?? null,
        strength: input.strength?.trim() ?? null,
        dosageForm: input.dosageForm?.trim() ?? null,
        packageDescription: input.packageDescription?.trim() ?? null,
        registrationNumber: input.registrationNumber?.trim() ?? null,
        prescriptionRequired: input.prescriptionRequired ?? false,
        imageUrl: input.imageUrl?.trim() || null,
        category: input.category?.trim() ?? null,
        manufacturer: input.manufacturer?.trim() ?? null,
        status: input.status ?? "Active",
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
      })
      .returning();
    if (!product) {
      throw new Error("Product insert did not return a row");
    }
    return product;
  }

  public async getProduct(id: string): Promise<typeof products.$inferSelect | undefined> {
    return (await this.database.db.select().from(products).where(eq(products.id, id)).limit(1))[0];
  }

  public async updateProduct(
    id: string,
    input: {
      sku?: string | undefined;
      barcode?: string | null | undefined;
      name?: string | undefined;
      genericName?: string | null | undefined;
      activeIngredient?: string | null | undefined;
      indications?: string | null | undefined;
      strength?: string | null | undefined;
      dosageForm?: string | null | undefined;
      packageDescription?: string | null | undefined;
      registrationNumber?: string | null | undefined;
      prescriptionRequired?: boolean | undefined;
      imageUrl?: string | null | undefined;
      category?: string | null | undefined;
      manufacturer?: string | null | undefined;
      status?: string | undefined;
      notes?: string | null | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<typeof products.$inferSelect | undefined> {
    const values: Partial<typeof products.$inferInsert> = {
      ...(input.sku === undefined ? {} : { sku: input.sku.trim() }),
      ...(input.barcode === undefined ? {} : { barcode: input.barcode?.trim() || null }),
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.genericName === undefined ? {} : { genericName: input.genericName?.trim() ?? null }),
      ...(input.activeIngredient === undefined ? {} : { activeIngredient: input.activeIngredient?.trim() ?? null }),
      ...(input.indications === undefined ? {} : { indications: input.indications?.trim() ?? null }),
      ...(input.strength === undefined ? {} : { strength: input.strength?.trim() ?? null }),
      ...(input.dosageForm === undefined ? {} : { dosageForm: input.dosageForm?.trim() ?? null }),
      ...(input.packageDescription === undefined
        ? {}
        : { packageDescription: input.packageDescription?.trim() ?? null }),
      ...(input.registrationNumber === undefined
        ? {}
        : { registrationNumber: input.registrationNumber?.trim() ?? null }),
      ...(input.prescriptionRequired === undefined ? {} : { prescriptionRequired: input.prescriptionRequired }),
      ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl?.trim() || null }),
      ...(input.category === undefined ? {} : { category: input.category?.trim() ?? null }),
      ...(input.manufacturer === undefined ? {} : { manufacturer: input.manufacturer?.trim() ?? null }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      updatedAt: new Date(),
    };
    const [product] = await this.database.db.update(products).set(values).where(eq(products.id, id)).returning();
    return product;
  }

  /** Deletes a product unless a unit, a price or an availability row of the catalog refers to it. */
  public async deleteProduct(id: string): Promise<DeleteOutcome> {
    const deleted = await this.database.db
      .delete(products)
      .where(
        and(
          eq(products.id, id),
          sql`NOT EXISTS (SELECT 1 FROM ${productUnits} WHERE ${productUnits.productId} = ${products.id})`,
          sql`NOT EXISTS (SELECT 1 FROM ${productPrices} WHERE ${productPrices.productId} = ${products.id})`,
          sql`NOT EXISTS (SELECT 1 FROM ${availabilityProjections} WHERE ${availabilityProjections.productId} = ${products.id})`,
        ),
      )
      .returning({ id: products.id });
    if (deleted.length > 0) return "deleted";
    return (await this.getProduct(id)) ? "in_use" : "not_found";
  }

  /**
   * One page of prices, newest effective date first, ties broken by id. `after` continues where the previous page
   * stopped, and the page is fetched one row over so the caller learns whether another page follows.
   */
  public async listPrices(
    input: PriceListFilters & { after?: KeysetPosition | undefined; limit?: number | undefined },
  ): Promise<KeysetPage<typeof productPrices.$inferSelect>> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const rows = await this.database.db
      .select()
      .from(productPrices)
      .where(
        and(
          ...priceFilters(input),
          input.after
            ? sql`(${productPrices.effectiveFrom}, ${productPrices.id}) < (${input.after.sortValue}::date, ${input.after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(productPrices.effectiveFrom), desc(productPrices.id))
      .limit(limit + 1);
    return takeKeysetPage(rows, limit);
  }

  public async countPrices(input: PriceListFilters): Promise<number> {
    const [row] = await this.database.db
      .select({ count: count() })
      .from(productPrices)
      .where(and(...priceFilters(input)));
    return Number(row?.count ?? 0);
  }

  /**
   * One row per active product with the price of one base unit effective on `day`, or null when no published price
   * qualifies. A price on a larger sale unit is divided by that unit's conversion factor. Among the qualifying prices
   * the base unit's own price wins over a larger unit's, and then the latest effective date wins. Only site-less prices
   * count, and the query is bounded by the product count, not by the price history.
   */
  public async listBasePricesOn(
    day: string,
  ): Promise<Array<{ productId: string; productName: string; unitPrice: number | null }>> {
    const qualifying = this.database.db
      .selectDistinctOn([productUnits.productId], {
        productId: productUnits.productId,
        unitPrice: sql<string>`(${productPrices.unitPrice} / ${productUnits.conversionFactorToBaseUnit})`.as(
          "unit_price",
        ),
      })
      .from(productPrices)
      .innerJoin(
        productUnits,
        and(eq(productUnits.id, productPrices.productUnitId), eq(productUnits.productId, productPrices.productId)),
      )
      .where(
        and(
          eq(productPrices.status, "Published"),
          isNull(productPrices.siteId),
          lte(productPrices.effectiveFrom, day),
          or(isNull(productPrices.effectiveTo), gte(productPrices.effectiveTo, day)),
          sql`${productUnits.conversionFactorToBaseUnit} > 0`,
        ),
      )
      .orderBy(
        asc(productUnits.productId),
        desc(productUnits.isBaseUnit),
        desc(productPrices.effectiveFrom),
        desc(productPrices.id),
      )
      .as("qualifying_prices");
    const rows = await this.database.db
      .select({ productId: products.id, productName: products.name, unitPrice: qualifying.unitPrice })
      .from(products)
      .leftJoin(qualifying, eq(qualifying.productId, products.id))
      .where(eq(products.isActive, true))
      .orderBy(asc(products.sku));
    return rows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      unitPrice: row.unitPrice === null ? null : Number(row.unitPrice),
    }));
  }

  public async createPrice(input: typeof productPrices.$inferInsert): Promise<typeof productPrices.$inferSelect> {
    if (input.siteId !== null && input.siteId !== undefined)
      throw new BusinessRuleError("Prices are global across pharmacies");
    if (Number(input.unitPrice) <= 0) throw new BusinessRuleError("Unit price must be greater than zero");
    const currency = input.currency ?? "VND";
    if (currency.length !== 3) throw new BusinessRuleError("Currency must be a three-letter code");
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom)
      throw new BusinessRuleError("Effective end date must not precede start date");
    const [price] = await this.database.db
      .insert(productPrices)
      .values({ ...input, siteId: null, currency, status: "Draft" })
      .returning();
    if (!price) throw new Error("Price insert did not return a row");
    return price;
  }

  public async transitionPrice(
    id: string,
    action: "publish" | "archive",
    actorId: string,
    notes?: string,
  ): Promise<typeof productPrices.$inferSelect | undefined> {
    const current = await this.database.db.select().from(productPrices).where(eq(productPrices.id, id)).limit(1);
    if (!current[0]) return undefined;
    if (action === "publish" && current[0].status !== "Draft")
      throw new BusinessRuleError("Only Draft prices can be published");
    if (action === "archive" && current[0].status === "Archived")
      throw new BusinessRuleError("Archived prices cannot be archived again");
    // Separation of duties: the person who created the draft never publishes it.
    if (action === "publish" && isSelfApproval(actorId, current[0].createdBy))
      throw new RefusalError(REFUSALS.priceSelfApproval);
    if (action === "publish") {
      const overlap = await this.database.db
        .select({ id: productPrices.id })
        .from(productPrices)
        .where(
          and(
            eq(productPrices.productId, current[0].productId),
            eq(productPrices.productUnitId, current[0].productUnitId),
            isNull(productPrices.siteId),
            eq(productPrices.status, "Published"),
            lte(productPrices.effectiveFrom, current[0].effectiveTo ?? "9999-12-31"),
            or(isNull(productPrices.effectiveTo), gte(productPrices.effectiveTo, current[0].effectiveFrom)),
          ),
        )
        .limit(1);
      if (overlap[0]) throw new BusinessRuleError("Published price windows must not overlap");
    }
    const now = new Date();
    const [price] = await this.database.db
      .update(productPrices)
      .set({
        status: action === "publish" ? "Published" : "Archived",
        publishedBy: action === "publish" ? actorId : undefined,
        archivedBy: action === "archive" ? actorId : undefined,
        publishedAt: action === "publish" ? now : undefined,
        archivedAt: action === "archive" ? now : undefined,
        ...(notes === undefined ? {} : { notes }),
        updatedAt: now,
      })
      .where(eq(productPrices.id, id))
      .returning();
    return price;
  }

  public async getActivePrice(
    productId: string,
    productUnitId: string,
    effectiveDate: string,
  ): Promise<typeof productPrices.$inferSelect | undefined> {
    const filters = [
      eq(productPrices.productId, productId),
      eq(productPrices.productUnitId, productUnitId),
      eq(productPrices.status, "Published"),
      isNull(productPrices.siteId),
      lte(productPrices.effectiveFrom, effectiveDate),
      or(isNull(productPrices.effectiveTo), gte(productPrices.effectiveTo, effectiveDate)),
    ];
    const rows = await this.database.db
      .select()
      .from(productPrices)
      .where(and(...filters))
      .orderBy(sql`${productPrices.effectiveFrom} DESC`)
      .limit(1);
    return rows[0];
  }

  private toSummary(row: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    location: { x: number; y: number } | null;
  }): StoreSummary {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      coordinates: row.location ? { longitude: row.location.x, latitude: row.location.y } : null,
    };
  }
}
