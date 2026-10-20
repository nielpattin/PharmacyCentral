import { z } from "zod";

export const importSchemaVersion = 1 as const;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const siteImportSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  siteType: z.string().trim().min(1).max(50),
  status: z.string().trim().max(30).optional(),
  address: optionalText(2000),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
  isCustomerFacing: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

export const storageLocationImportSchema = z.object({
  siteCode: z.string().trim().min(1).max(50),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  locationType: z.string().trim().min(1).max(50),
  status: z.string().trim().max(30).optional(),
  capacity: z.number().nonnegative().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const supplierImportSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(300),
  contactName: optionalText(200),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: optionalText(50),
  address: optionalText(2000),
  status: z.string().trim().max(30).optional(),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
});

export const productUnitImportSchema = z.object({
  unitName: z.string().trim().min(1).max(100),
  conversionFactorToBaseUnit: z.coerce.number().positive(),
  isBaseUnit: z.boolean().optional(),
  isDefaultSaleUnit: z.boolean().optional(),
  isDefaultPurchaseUnit: z.boolean().optional(),
  barcode: optionalText(100),
  sortOrder: z.number().int().optional(),
});

export const productPriceImportSchema = z.object({
  unitPrice: z.coerce.number().positive(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .default("VND")
    .transform((value) => value.toUpperCase()),
  status: z.enum(["Draft", "Published", "Archived"]).default("Published"),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable().optional(),
  notes: optionalText(2000),
});

export const productImportSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  barcode: optionalText(100),
  name: z.string().trim().min(1).max(300),
  genericName: optionalText(300),
  activeIngredient: optionalText(2000),
  indications: optionalText(4000),
  strength: optionalText(150),
  dosageForm: optionalText(150),
  packageDescription: optionalText(500),
  registrationNumber: optionalText(100),
  prescriptionRequired: z.boolean().optional(),
  imageUrl: z.string().trim().url().max(2000).nullable().optional(),
  category: optionalText(150),
  manufacturer: optionalText(300),
  status: z.string().trim().max(30).optional(),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
  units: z.array(productUnitImportSchema).default([]),
  price: productPriceImportSchema.optional(),
});

export const catalogImportSchema = z
  .object({
    schemaVersion: z.literal(importSchemaVersion),
    sites: z.array(siteImportSchema).default([]),
    storageLocations: z.array(storageLocationImportSchema).default([]),
    suppliers: z.array(supplierImportSchema).default([]),
    products: z.array(productImportSchema).default([]),
  })
  .refine(
    (value) => value.sites.length + value.storageLocations.length + value.suppliers.length + value.products.length > 0,
    "Import payload must include at least one site, storage location, supplier, or product",
  );

export type CatalogImport = z.infer<typeof catalogImportSchema>;
export type CatalogImportProduct = z.infer<typeof productImportSchema>;

export type CatalogImportResult = {
  sites: number;
  storageLocations: number;
  suppliers: number;
  products: number;
  productUnits: number;
  prices: number;
};
