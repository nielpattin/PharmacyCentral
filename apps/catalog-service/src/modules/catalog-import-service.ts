import { and, eq, isNull } from "drizzle-orm";

import type { CatalogImport, CatalogImportResult } from "../contracts/imports.ts";
import type { CatalogDatabase } from "../shared/infrastructure/database.ts";
import {
  productPrices,
  productUnits,
  products,
  sites,
  storageLocations,
  suppliers,
} from "../shared/infrastructure/schema.ts";

export class CatalogImportService {
  public constructor(private readonly database: CatalogDatabase) {}

  public async import(input: CatalogImport): Promise<CatalogImportResult> {
    return this.database.db.transaction(async (transaction) => {
      for (const site of input.sites) {
        const location =
          site.latitude === null ||
          site.latitude === undefined ||
          site.longitude === null ||
          site.longitude === undefined
            ? null
            : { x: site.longitude, y: site.latitude };
        await transaction
          .insert(sites)
          .values({
            code: site.code,
            name: site.name,
            siteType: site.siteType,
            status: site.status ?? "Active",
            address: site.address ?? null,
            notes: site.notes ?? null,
            isActive: site.isActive ?? true,
            isCustomerFacing: site.isCustomerFacing ?? false,
            location,
          })
          .onConflictDoUpdate({
            target: sites.code,
            set: {
              name: site.name,
              siteType: site.siteType,
              status: site.status ?? "Active",
              address: site.address ?? null,
              notes: site.notes ?? null,
              isActive: site.isActive ?? true,
              isCustomerFacing: site.isCustomerFacing ?? false,
              location,
              updatedAt: new Date(),
            },
          });
      }

      const siteRows = await transaction.select({ id: sites.id, code: sites.code }).from(sites);
      const siteIds = new Map(siteRows.map((row) => [row.code, row.id]));
      for (const location of input.storageLocations) {
        const siteId = siteIds.get(location.siteCode);
        if (!siteId) throw new Error(`Storage location ${location.code} references unknown site ${location.siteCode}`);
        await transaction
          .insert(storageLocations)
          .values({
            siteId,
            code: location.code,
            name: location.name,
            locationType: location.locationType,
            status: location.status ?? "Active",
            capacity: location.capacity === null || location.capacity === undefined ? null : String(location.capacity),
            isActive: location.isActive ?? true,
          })
          .onConflictDoUpdate({
            target: [storageLocations.siteId, storageLocations.code],
            set: {
              name: location.name,
              locationType: location.locationType,
              status: location.status ?? "Active",
              capacity:
                location.capacity === null || location.capacity === undefined ? null : String(location.capacity),
              isActive: location.isActive ?? true,
              updatedAt: new Date(),
            },
          });
      }

      for (const supplier of input.suppliers) {
        await transaction
          .insert(suppliers)
          .values({
            code: supplier.code,
            name: supplier.name,
            contactName: supplier.contactName ?? null,
            email: supplier.email ?? null,
            phone: supplier.phone ?? null,
            address: supplier.address ?? null,
            status: supplier.status ?? "Active",
            notes: supplier.notes ?? null,
            isActive: supplier.isActive ?? true,
          })
          .onConflictDoUpdate({
            target: suppliers.code,
            set: {
              name: supplier.name,
              contactName: supplier.contactName ?? null,
              email: supplier.email ?? null,
              phone: supplier.phone ?? null,
              address: supplier.address ?? null,
              status: supplier.status ?? "Active",
              notes: supplier.notes ?? null,
              isActive: supplier.isActive ?? true,
            },
          });
      }

      let productUnitsImported = 0;
      let pricesImported = 0;
      for (const product of input.products) {
        const [saved] = await transaction
          .insert(products)
          .values({
            sku: product.sku,
            barcode: product.barcode ?? null,
            name: product.name,
            genericName: product.genericName ?? null,
            activeIngredient: product.activeIngredient ?? null,
            indications: product.indications ?? null,
            strength: product.strength ?? null,
            dosageForm: product.dosageForm ?? null,
            packageDescription: product.packageDescription ?? null,
            registrationNumber: product.registrationNumber ?? null,
            prescriptionRequired: product.prescriptionRequired ?? false,
            imageUrl: product.imageUrl ?? null,
            category: product.category ?? null,
            manufacturer: product.manufacturer ?? null,
            status: product.status ?? "Active",
            notes: product.notes ?? null,
            isActive: product.isActive ?? true,
          })
          .onConflictDoUpdate({
            target: products.sku,
            set: {
              barcode: product.barcode ?? null,
              name: product.name,
              genericName: product.genericName ?? null,
              activeIngredient: product.activeIngredient ?? null,
              indications: product.indications ?? null,
              strength: product.strength ?? null,
              dosageForm: product.dosageForm ?? null,
              packageDescription: product.packageDescription ?? null,
              registrationNumber: product.registrationNumber ?? null,
              prescriptionRequired: product.prescriptionRequired ?? false,
              imageUrl: product.imageUrl ?? null,
              category: product.category ?? null,
              manufacturer: product.manufacturer ?? null,
              status: product.status ?? "Active",
              notes: product.notes ?? null,
              isActive: product.isActive ?? true,
              updatedAt: new Date(),
            },
          })
          .returning({ id: products.id });
        if (!saved) throw new Error(`Product ${product.sku} was not saved`);

        for (const unit of product.units) {
          await transaction
            .insert(productUnits)
            .values({
              productId: saved.id,
              unitName: unit.unitName,
              conversionFactorToBaseUnit: String(unit.conversionFactorToBaseUnit),
              isBaseUnit: unit.isBaseUnit ?? false,
              isDefaultSaleUnit: unit.isDefaultSaleUnit ?? false,
              isDefaultPurchaseUnit: unit.isDefaultPurchaseUnit ?? false,
              barcode: unit.barcode ?? null,
              sortOrder: unit.sortOrder ?? 0,
            })
            .onConflictDoUpdate({
              target: [productUnits.productId, productUnits.unitName],
              set: {
                conversionFactorToBaseUnit: String(unit.conversionFactorToBaseUnit),
                isBaseUnit: unit.isBaseUnit ?? false,
                isDefaultSaleUnit: unit.isDefaultSaleUnit ?? false,
                isDefaultPurchaseUnit: unit.isDefaultPurchaseUnit ?? false,
                barcode: unit.barcode ?? null,
                sortOrder: unit.sortOrder ?? 0,
              },
            });
          productUnitsImported += 1;
        }

        if (product.price) {
          const price = product.price;
          const savedUnits = await transaction
            .select({
              id: productUnits.id,
              unitName: productUnits.unitName,
              isDefaultSaleUnit: productUnits.isDefaultSaleUnit,
            })
            .from(productUnits)
            .where(eq(productUnits.productId, saved.id));
          const priceUnit =
            savedUnits.find((unit) => unit.isDefaultSaleUnit) ??
            savedUnits.find((unit) => unit.unitName === product.units[0]?.unitName) ??
            savedUnits[0];
          if (!priceUnit) throw new Error(`Product ${product.sku} has a price but no unit to attach it to`);
          const existing = await transaction
            .select({ id: productPrices.id })
            .from(productPrices)
            .where(
              and(
                eq(productPrices.productId, saved.id),
                eq(productPrices.productUnitId, priceUnit.id),
                isNull(productPrices.siteId),
                eq(productPrices.effectiveFrom, price.effectiveFrom),
              ),
            )
            .limit(1);
          const now = new Date();
          if (existing[0]) {
            await transaction
              .update(productPrices)
              .set({
                unitPrice: String(price.unitPrice),
                currency: price.currency,
                status: price.status,
                effectiveTo: price.effectiveTo ?? null,
                notes: price.notes ?? null,
                publishedAt: price.status === "Published" ? now : null,
                updatedAt: now,
              })
              .where(eq(productPrices.id, existing[0].id));
          } else {
            await transaction.insert(productPrices).values({
              productId: saved.id,
              productUnitId: priceUnit.id,
              siteId: null,
              unitPrice: String(price.unitPrice),
              currency: price.currency,
              status: price.status,
              effectiveFrom: price.effectiveFrom,
              effectiveTo: price.effectiveTo ?? null,
              notes: price.notes ?? null,
              publishedAt: price.status === "Published" ? now : null,
            });
          }
          pricesImported += 1;
        }
      }

      return {
        sites: input.sites.length,
        storageLocations: input.storageLocations.length,
        suppliers: input.suppliers.length,
        products: input.products.length,
        productUnits: productUnitsImported,
        prices: pricesImported,
      };
    });
  }
}
