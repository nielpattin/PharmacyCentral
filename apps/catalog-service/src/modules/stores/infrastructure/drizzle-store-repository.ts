import { and, asc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";

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

export type Coordinates = { latitude: number; longitude: number };

export type StoreSummary = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  coordinates: Coordinates | null;
};

export class DrizzleStoreRepository {
  public constructor(private readonly database: CatalogDatabase) {}

  public async listActiveStores(limit = 50): Promise<StoreSummary[]> {
    const rows = await this.database.db
      .select({ id: sites.id, code: sites.code, name: sites.name, address: sites.address, location: sites.location })
      .from(sites)
      .where(and(eq(sites.isActive, true), eq(sites.isCustomerFacing, true)))
      .orderBy(asc(sites.code))
      .limit(Math.min(Math.max(limit, 1), 100));

    return rows.map((row) => this.toSummary(row));
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

  public async searchProducts(
    search: string | undefined,
    limit = 20,
    category?: string,
  ): Promise<Array<typeof products.$inferSelect>> {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const filters = [
      eq(products.isActive, true),
      search
        ? or(
            ilike(products.name, `%${search}%`),
            ilike(products.sku, `%${search}%`),
            ilike(products.barcode, `%${search}%`),
          )
        : undefined,
      category ? eq(products.category, category) : undefined,
    ].filter((filter): filter is NonNullable<typeof filter> => filter !== undefined);
    return this.database.db
      .select()
      .from(products)
      .where(and(...filters))
      .orderBy(asc(products.sku))
      .limit(boundedLimit);
  }

  public async listProductUnits(productId: string): Promise<Array<typeof productUnits.$inferSelect>> {
    return this.database.db
      .select()
      .from(productUnits)
      .where(eq(productUnits.productId, productId))
      .orderBy(asc(productUnits.sortOrder));
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
    siteId?: string,
  ): Promise<Array<typeof availabilityProjections.$inferSelect>> {
    const filters = [
      productId ? eq(availabilityProjections.productId, productId) : undefined,
      siteId ? eq(availabilityProjections.siteId, siteId) : undefined,
    ].filter((filter): filter is NonNullable<typeof filter> => filter !== undefined);
    return this.database.db
      .select()
      .from(availabilityProjections)
      .where(filters.length ? and(...filters) : undefined);
  }

  public async listSites(): Promise<Array<typeof sites.$inferSelect>> {
    return this.database.db.select().from(sites).orderBy(asc(sites.code));
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

  public async deleteSite(id: string): Promise<void> {
    await this.database.db.delete(sites).where(eq(sites.id, id));
  }

  public async listStorageLocations(siteId?: string): Promise<Array<typeof storageLocations.$inferSelect>> {
    const query = this.database.db.select().from(storageLocations);
    return siteId
      ? query.where(eq(storageLocations.siteId, siteId)).orderBy(asc(storageLocations.code))
      : query.orderBy(asc(storageLocations.code));
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

  public async deleteStorageLocation(id: string): Promise<void> {
    await this.database.db.delete(storageLocations).where(eq(storageLocations.id, id));
  }

  public async listSuppliers(): Promise<Array<typeof suppliers.$inferSelect>> {
    return this.database.db.select().from(suppliers).orderBy(asc(suppliers.code));
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

  public async deleteSupplier(id: string): Promise<void> {
    await this.database.db.delete(suppliers).where(eq(suppliers.id, id));
  }

  public async createProduct(input: {
    sku: string;
    barcode?: string | null | undefined;
    name: string;
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

  public async deleteProduct(id: string): Promise<void> {
    await this.database.db.delete(products).where(eq(products.id, id));
  }

  public async listPrices(input: {
    productId?: string | undefined;
    siteId?: string | undefined;
    status?: string | undefined;
    limit?: number | undefined;
  }): Promise<Array<typeof productPrices.$inferSelect>> {
    const filters = [
      input.productId ? eq(productPrices.productId, input.productId) : undefined,
      input.siteId ? or(eq(productPrices.siteId, input.siteId), isNull(productPrices.siteId)) : undefined,
      input.status ? eq(productPrices.status, input.status) : undefined,
    ].filter((filter): filter is NonNullable<typeof filter> => filter !== undefined);
    const query = this.database.db.select().from(productPrices);
    return query
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(productPrices.effectiveFrom))
      .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
  }

  public async createPrice(input: typeof productPrices.$inferInsert): Promise<typeof productPrices.$inferSelect> {
    if (Number(input.unitPrice) <= 0) throw new Error("Unit price must be greater than zero");
    const currency = input.currency ?? "VND";
    if (currency.length !== 3) throw new Error("Currency must be a three-letter code");
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom)
      throw new Error("Effective end date must not precede start date");
    const [price] = await this.database.db
      .insert(productPrices)
      .values({ ...input, currency, status: "Draft" })
      .returning();
    if (!price) throw new Error("Price insert did not return a row");
    return price;
  }

  public async transitionPrice(
    id: string,
    action: "publish" | "archive",
    actorId?: string,
    notes?: string,
  ): Promise<typeof productPrices.$inferSelect | undefined> {
    const current = await this.database.db.select().from(productPrices).where(eq(productPrices.id, id)).limit(1);
    if (!current[0]) return undefined;
    if (action === "publish" && current[0].status !== "Draft") throw new Error("Only Draft prices can be published");
    if (action === "archive" && current[0].status === "Archived")
      throw new Error("Archived prices cannot be archived again");
    if (action === "publish") {
      const overlap = await this.database.db
        .select({ id: productPrices.id })
        .from(productPrices)
        .where(
          and(
            eq(productPrices.productId, current[0].productId),
            eq(productPrices.productUnitId, current[0].productUnitId),
            current[0].siteId ? eq(productPrices.siteId, current[0].siteId) : isNull(productPrices.siteId),
            eq(productPrices.status, "Published"),
            lte(productPrices.effectiveFrom, current[0].effectiveTo ?? "9999-12-31"),
            or(isNull(productPrices.effectiveTo), gte(productPrices.effectiveTo, current[0].effectiveFrom)),
          ),
        )
        .limit(1);
      if (overlap[0]) throw new Error("Published price windows must not overlap");
    }
    const now = new Date();
    const [price] = await this.database.db
      .update(productPrices)
      .set({
        status: action === "publish" ? "Published" : "Archived",
        publishedBy: action === "publish" ? (actorId ?? null) : undefined,
        archivedBy: action === "archive" ? (actorId ?? null) : undefined,
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
    siteId: string | undefined,
    effectiveDate: string,
  ): Promise<typeof productPrices.$inferSelect | undefined> {
    const filters = [
      eq(productPrices.productId, productId),
      eq(productPrices.productUnitId, productUnitId),
      eq(productPrices.status, "Published"),
      lte(productPrices.effectiveFrom, effectiveDate),
      or(isNull(productPrices.effectiveTo), gte(productPrices.effectiveTo, effectiveDate)),
      siteId ? or(eq(productPrices.siteId, siteId), isNull(productPrices.siteId)) : isNull(productPrices.siteId),
    ];
    const rows = await this.database.db
      .select()
      .from(productPrices)
      .where(and(...filters))
      .orderBy(
        sql`CASE WHEN ${productPrices.siteId} = ${siteId ?? null} THEN 0 ELSE 1 END`,
        sql`${productPrices.effectiveFrom} DESC`,
      )
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
