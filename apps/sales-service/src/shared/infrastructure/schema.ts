import { sql } from "drizzle-orm";
import {
  boolean,
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

import type { ConsultationLine } from "../../contracts/prescription-consultation.ts";
import type { IntakePrescription } from "../../contracts/prescription-intake.ts";

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id"),
    guestTokenDigest: varchar("guest_token_digest", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("carts_customer_unique").on(table.customerId),
    uniqueIndex("carts_guest_token_unique").on(table.guestTokenDigest),
  ],
);

export const cartLines = pgTable(
  "cart_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cartId: uuid("cart_id").notNull(),
    productId: uuid("product_id").notNull(),
    productUnitId: uuid("product_unit_id").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("cart_lines_cart_product_unit_unique").on(table.cartId, table.productId, table.productUnitId),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("Pending"),
    fulfillmentType: varchar("fulfillment_type", { length: 20 }).notNull(),
    selectedStoreId: uuid("selected_store_id").notNull(),
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull(),
    deliveryFee: numeric("delivery_fee", { precision: 18, scale: 2 }).notNull().default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("VND"),
    paymentStatus: varchar("payment_status", { length: 20 }).notNull().default("Pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("orders_customer_created_idx").on(table.customerId, table.createdAt),
    index("orders_store_status_idx").on(table.selectedStoreId, table.status),
  ],
);

export const orderLines = pgTable("order_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  productId: uuid("product_id").notNull(),
  productUnitId: uuid("product_unit_id").notNull(),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  unitPriceSnapshot: numeric("unit_price_snapshot", { precision: 18, scale: 2 }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
});

export const deliveryAddresses = pgTable(
  "delivery_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
    longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
    providerResolvedAddress: text("provider_resolved_address").notNull(),
    addressNote: text("address_note"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("delivery_addresses_customer_idx").on(table.customerId, table.updatedAt),
    // At most one default per shopper, so a partial unique index can carry the rule.
    uniqueIndex("delivery_addresses_customer_default_unique")
      .on(table.customerId)
      .where(sql`${table.isDefault}`),
  ],
);

export const orderDeliverySnapshots = pgTable("order_delivery_snapshots", {
  orderId: uuid("order_id").primaryKey(),
  selectedStoreId: uuid("selected_store_id").notNull(),
  originLatitude: numeric("origin_latitude", { precision: 10, scale: 7 }).notNull(),
  originLongitude: numeric("origin_longitude", { precision: 10, scale: 7 }).notNull(),
  destinationLatitude: numeric("destination_latitude", { precision: 10, scale: 7 }).notNull(),
  destinationLongitude: numeric("destination_longitude", { precision: 10, scale: 7 }).notNull(),
  providerResolvedAddress: text("provider_resolved_address").notNull(),
  addressNote: text("address_note"),
  distanceMeters: numeric("distance_meters", { precision: 18, scale: 2 }).notNull(),
  durationSeconds: numeric("duration_seconds", { precision: 18, scale: 2 }).notNull(),
  routeGeoJson: text("route_geo_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const prescriptions = pgTable(
  "prescriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    prescriptionNumber: varchar("prescription_number", { length: 100 }).notNull(),
    siteId: uuid("site_id").notNull(),
    storageLocationId: uuid("storage_location_id").notNull(),
    patientName: varchar("patient_name", { length: 200 }).notNull(),
    patientPhone: varchar("patient_phone", { length: 50 }),
    // Walk-in patients have no account, so ownership stays optional; a linked record is the customer's to see.
    customerId: uuid("customer_id"),
    doctorName: varchar("doctor_name", { length: 200 }),
    doctorLicense: varchar("doctor_license", { length: 100 }),
    notes: text("notes"),
    status: varchar("status", { length: 30 }).notNull().default("Draft"),
    reservationId: uuid("reservation_id"),
    createdBy: uuid("created_by").notNull(),
    cancelledBy: uuid("cancelled_by"),
    dispensedBy: uuid("dispensed_by"),
    dispensedAt: timestamp("dispensed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("prescriptions_number_unique").on(table.prescriptionNumber),
    index("prescriptions_site_status_idx").on(table.siteId, table.status, table.createdAt),
    index("prescriptions_customer_created_idx").on(table.customerId, table.createdAt),
  ],
);

export const prescriptionLines = pgTable("prescription_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  prescriptionId: uuid("prescription_id").notNull(),
  productId: uuid("product_id").notNull(),
  productUnitId: uuid("product_unit_id").notNull(),
  prescribedQuantity: numeric("prescribed_quantity", { precision: 18, scale: 6 }).notNull(),
  dispensedQuantity: numeric("dispensed_quantity", { precision: 18, scale: 6 }).notNull().default("0"),
  productBatchId: uuid("product_batch_id"),
  dosage: text("dosage"),
  frequency: text("frequency"),
  duration: text("duration"),
  notes: text("notes"),
});

/**
 * A shopper's whole prescription sent to the pharmacists. It is not a `prescriptions` row: nothing in it is
 * fillable yet, no product, unit, site or storage location is chosen and no stock is reserved. It keeps the
 * prescription as it was read plus the shopper's own note, and the pharmacists' single written answer.
 */
export const prescriptionConsultations = pgTable(
  "prescription_consultations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").notNull(),
    siteId: uuid("site_id"),
    source: varchar("source", { length: 10 }).notNull(),
    prescription: jsonb("prescription").$type<IntakePrescription>().notNull(),
    lines: jsonb("lines").$type<ConsultationLine[]>().notNull(),
    note: text("note"),
    status: varchar("status", { length: 20 }).notNull().default("Open"),
    reply: text("reply"),
    answeredBy: uuid("answered_by"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("prescription_consultations_customer_created_idx").on(table.customerId, table.createdAt),
    index("prescription_consultations_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const idempotencyRecords = pgTable(
  "sales_idempotency_records",
  {
    key: varchar("key", { length: 128 }).notNull(),
    scope: varchar("scope", { length: 200 }).notNull(),
    actorId: uuid("actor_id").notNull(),
    response: text("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sales_idempotency_scope_key_actor_unique").on(table.scope, table.key, table.actorId)],
);

export const outboxMessages = pgTable("outbox_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  eventType: varchar("event_type", { length: 200 }).notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  payload: text("payload").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
});
