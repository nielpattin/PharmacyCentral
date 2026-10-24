import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  geometry,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type { SearchSynonymTerms } from "../../contracts/synonyms.ts";

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    siteType: varchar("site_type", { length: 50 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("Active"),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    isCustomerFacing: boolean("is_customer_facing").notNull().default(false),
    location: geometry("location", { type: "point", mode: "xy", srid: 4326 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sites_code_unique").on(table.code),
    index("sites_location_gist").using("gist", table.location),
  ],
);

export const storageLocations = pgTable(
  "storage_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id").notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    locationType: varchar("location_type", { length: 50 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("Active"),
    capacity: numeric("capacity", { precision: 18, scale: 6 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("storage_locations_site_code_unique").on(table.siteId, table.code)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sku: varchar("sku", { length: 100 }).notNull(),
    barcode: varchar("barcode", { length: 100 }),
    name: varchar("name", { length: 300 }).notNull(),
    genericName: varchar("generic_name", { length: 300 }),
    activeIngredient: text("active_ingredient"),
    indications: text("indications"),
    strength: varchar("strength", { length: 150 }),
    dosageForm: varchar("dosage_form", { length: 150 }),
    packageDescription: varchar("package_description", { length: 500 }),
    registrationNumber: varchar("registration_number", { length: 100 }),
    prescriptionRequired: boolean("prescription_required").notNull().default(false),
    imageUrl: text("image_url"),
    category: varchar("category", { length: 150 }),
    manufacturer: varchar("manufacturer", { length: 300 }),
    status: varchar("status", { length: 30 }).notNull().default("Active"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("products_sku_unique").on(table.sku),
    uniqueIndex("products_barcode_unique").on(table.barcode),
  ],
);

export const productUnits = pgTable(
  "product_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull(),
    unitName: varchar("unit_name", { length: 100 }).notNull(),
    conversionFactorToBaseUnit: numeric("conversion_factor_to_base_unit", { precision: 18, scale: 6 }).notNull(),
    isBaseUnit: boolean("is_base_unit").notNull().default(false),
    isDefaultSaleUnit: boolean("is_default_sale_unit").notNull().default(false),
    isDefaultPurchaseUnit: boolean("is_default_purchase_unit").notNull().default(false),
    barcode: varchar("barcode", { length: 100 }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [uniqueIndex("product_units_product_name_unique").on(table.productId, table.unitName)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 300 }).notNull(),
    contactName: varchar("contact_name", { length: 200 }),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 50 }),
    address: text("address"),
    status: varchar("status", { length: 30 }).notNull().default("Active"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [uniqueIndex("suppliers_code_unique").on(table.code)],
);

export const productPrices = pgTable(
  "product_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull(),
    productUnitId: uuid("product_unit_id").notNull(),
    siteId: uuid("site_id"),
    unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("VND"),
    status: varchar("status", { length: 20 }).notNull().default("Draft"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    publishedBy: uuid("published_by"),
    archivedBy: uuid("archived_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("product_prices_lookup_idx").on(
      table.productId,
      table.productUnitId,
      table.siteId,
      table.status,
      table.effectiveFrom,
    ),
    index("product_prices_effective_from_idx").on(table.effectiveFrom.desc(), table.id.desc()),
    check("product_prices_global_scope_check", sql`${table.siteId} IS NULL`),
  ],
);

export const availabilityProjections = pgTable(
  "availability_projections",
  {
    productId: uuid("product_id").notNull(),
    siteId: uuid("site_id").notNull(),
    inStock: boolean("in_stock").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("availability_product_site_unique").on(table.productId, table.siteId)],
);

export const outboxMessages = pgTable(
  "outbox_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: varchar("event_type", { length: 200 }).notNull(),
    schemaVersion: varchar("schema_version", { length: 20 }).notNull(),
    payload: text("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [index("outbox_pending_idx").on(table.publishedAt, table.occurredAt)],
);

export const inboxMessages = pgTable("inbox_messages", {
  eventId: uuid("event_id").primaryKey(),
  eventType: varchar("event_type", { length: 200 }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiCredentials = pgTable("ai_credentials", {
  purpose: varchar("purpose", { length: 32 }).primaryKey(),
  provider: varchar("provider", { length: 32 }).notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  baseUrl: varchar("base_url", { length: 512 }).notNull(),
  ciphertext: text("ciphertext").notNull(),
  last4: varchar("last4", { length: 4 }).notNull(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const searchSynonymGroups = pgTable(
  "search_synonym_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    terms: jsonb("terms").$type<SearchSynonymTerms>().notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    submittedBy: uuid("submitted_by").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (table) => [
    check("search_synonym_groups_status_check", sql`${table.status} IN ('pending', 'approved')`),
    check(
      "search_synonym_groups_review_check",
      sql`(${table.status} = 'approved' AND ${table.approvedBy} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)
        OR (${table.status} = 'pending' AND ${table.approvedBy} IS NULL AND ${table.approvedAt} IS NULL)`,
    ),
  ],
);
