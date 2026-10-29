import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { currentTraceparent } from "./trace-context.ts";

export const productBatches = pgTable(
  "product_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull(),
    supplierId: uuid("supplier_id"),
    batchNumber: varchar("batch_number", { length: 100 }).notNull(),
    manufacturedDate: date("manufactured_date"),
    expiryDate: date("expiry_date").notNull(),
    manufacturer: varchar("manufacturer", { length: 300 }),
    status: varchar("status", { length: 30 }).notNull().default("Active"),
    qualityStatus: varchar("quality_status", { length: 20 }).notNull().default("PendingQc"),
    qualityReviewedBy: uuid("quality_reviewed_by"),
    qualityReviewedAt: timestamp("quality_reviewed_at", { withTimezone: true }),
    qualityNotes: text("quality_notes"),
    isActive: boolean("is_active").notNull().default(true),
    /** The user who recorded the batch's first receipt or import; NULL for batches that predate the column. */
    createdBy: uuid("created_by"),
  },
  (table) => [
    uniqueIndex("product_batches_product_number_unique").on(table.productId, table.batchNumber),
    index("product_batches_expiry_id_idx").on(table.expiryDate, table.id),
  ],
);

export const inventoryBalances = pgTable(
  "inventory_balances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productBatchId: uuid("product_batch_id").notNull(),
    siteId: uuid("site_id").notNull(),
    storageLocationId: uuid("storage_location_id").notNull(),
    quantityOnHand: numeric("quantity_on_hand", { precision: 18, scale: 6 }).notNull().default("0"),
    quantityReserved: numeric("quantity_reserved", { precision: 18, scale: 6 }).notNull().default("0"),
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("inventory_balance_batch_location_unique").on(table.productBatchId, table.storageLocationId),
    index("inventory_balance_product_site_idx").on(table.productBatchId, table.siteId),
  ],
);

export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull(),
    productBatchId: uuid("product_batch_id").notNull(),
    siteId: uuid("site_id").notNull(),
    storageLocationId: uuid("storage_location_id").notNull(),
    adjustmentType: varchar("adjustment_type", { length: 20 }).notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    reason: text("reason").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("Pending"),
    createdBy: uuid("created_by").notNull(),
    approvedBy: uuid("approved_by"),
    approvalNotes: text("approval_notes"),
    notes: text("notes"),
    stocktakeSessionId: uuid("stocktake_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("stock_adjustments_created_id_idx").on(table.createdAt, table.id)],
);

export const stockLedgerEntries = pgTable(
  "stock_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull(),
    productBatchId: uuid("product_batch_id").notNull(),
    siteId: uuid("site_id").notNull(),
    storageLocationId: uuid("storage_location_id").notNull(),
    quantityDelta: numeric("quantity_delta", { precision: 18, scale: 6 }).notNull(),
    quantityAfter: numeric("quantity_after", { precision: 18, scale: 6 }).notNull(),
    movementType: varchar("movement_type", { length: 80 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    referenceType: varchar("reference_type", { length: 80 }),
    referenceId: uuid("reference_id"),
    reason: text("reason"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("stock_ledger_product_occurred_idx").on(table.productId, table.occurredAt),
    index("stock_ledger_entries_occurred_id_idx").on(table.occurredAt, table.id),
  ],
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("stock_reservations_owner_idx").on(table.ownerId, table.status)],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    key: varchar("key", { length: 128 }).notNull(),
    scope: varchar("scope", { length: 200 }).notNull(),
    actorId: uuid("actor_id"),
    response: text("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idempotency_scope_key_actor_unique").on(table.scope, table.key, table.actorId)],
);

export const stockReservationLines = pgTable(
  "stock_reservation_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id").notNull(),
    productId: uuid("product_id").notNull(),
    productBatchId: uuid("product_batch_id").notNull(),
    storageLocationId: uuid("storage_location_id").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  },
  (table) => [index("stock_reservation_lines_reservation_id_idx").on(table.reservationId)],
);

export const transferOrders = pgTable(
  "transfer_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transferNumber: varchar("transfer_number", { length: 100 }).notNull(),
    sourceSiteId: uuid("source_site_id").notNull(),
    destinationSiteId: uuid("destination_site_id").notNull(),
    sourceStorageLocationId: uuid("source_storage_location_id"),
    destinationStorageLocationId: uuid("destination_storage_location_id"),
    status: varchar("status", { length: 30 }).notNull().default("PendingApproval"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull(),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transfer_orders_number_unique").on(table.transferNumber),
    index("transfer_orders_created_id_idx").on(table.createdAt, table.id),
  ],
);

export const transferOrderLines = pgTable("transfer_order_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  transferOrderId: uuid("transfer_order_id").notNull(),
  productId: uuid("product_id").notNull(),
  productBatchId: uuid("product_batch_id"),
  sourceStorageLocationId: uuid("source_storage_location_id"),
  destinationStorageLocationId: uuid("destination_storage_location_id"),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  requestedQuantity: numeric("requested_quantity", { precision: 18, scale: 6 }),
  shippedQuantity: numeric("shipped_quantity", { precision: 18, scale: 6 }).notNull().default("0"),
  receivedQuantity: numeric("received_quantity", { precision: 18, scale: 6 }).notNull().default("0"),
  notes: text("notes"),
});

export const replenishmentRequests = pgTable(
  "replenishment_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id").notNull(),
    storageLocationId: uuid("storage_location_id").notNull(),
    notes: text("notes"),
    status: varchar("status", { length: 20 }).notNull().default("Pending"),
    requestedBy: uuid("requested_by").notNull(),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("replenishment_requests_created_id_idx").on(table.createdAt, table.id)],
);

export const replenishmentRequestLines = pgTable("replenishment_request_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  replenishmentRequestId: uuid("replenishment_request_id").notNull(),
  productId: uuid("product_id").notNull(),
  productBatchId: uuid("product_batch_id"),
  requestedQuantity: numeric("requested_quantity", { precision: 18, scale: 6 }).notNull(),
  reason: varchar("reason", { length: 80 }),
  notes: text("notes"),
});

export const stocktakes = pgTable(
  "stocktakes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id").notNull(),
    storageLocationId: uuid("storage_location_id").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("Pending"),
    notes: text("notes"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("stocktakes_created_id_idx").on(table.createdAt, table.id)],
);

export const stocktakeLines = pgTable("stocktake_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  stocktakeId: uuid("stocktake_id").notNull(),
  productBatchId: uuid("product_batch_id").notNull(),
  systemQuantity: numeric("system_quantity", { precision: 18, scale: 6 }).notNull(),
  countedQuantity: numeric("counted_quantity", { precision: 18, scale: 6 }),
  status: varchar("status", { length: 20 }).notNull().default("Pending"),
  /** The user who recorded this line's count; NULL for counts recorded before the column. */
  countedBy: uuid("counted_by"),
});

export const returnRequests = pgTable(
  "return_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("Pending"),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("return_requests_created_id_idx").on(table.createdAt, table.id)],
);

export const returnLines = pgTable("return_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  returnRequestId: uuid("return_request_id").notNull(),
  productBatchId: uuid("product_batch_id").notNull(),
  storageLocationId: uuid("storage_location_id"),
  quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
  destination: text("destination"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  notes: text("notes"),
});

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
    traceparent: varchar("traceparent", { length: 200 }).$type<string | null>().$defaultFn(currentTraceparent),
  },
  (table) => [
    index("outbox_messages_unpublished_idx")
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);

export const inboxMessages = pgTable("inbox_messages", {
  eventId: uuid("event_id").primaryKey(),
  eventType: varchar("event_type", { length: 200 }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseOrderNumber: varchar("purchase_order_number", { length: 100 }).notNull(),
    supplierId: uuid("supplier_id").notNull(),
    siteId: uuid("site_id").notNull(),
    expectedDate: date("expected_date"),
    status: varchar("status", { length: 30 }).notNull().default("Draft"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull(),
    approvedBy: uuid("approved_by"),
    cancelledBy: uuid("cancelled_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("purchase_orders_number_unique").on(table.purchaseOrderNumber),
    index("purchase_orders_site_status_idx").on(table.siteId, table.status),
    index("purchase_orders_created_id_idx").on(table.createdAt, table.id),
  ],
);

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  purchaseOrderId: uuid("purchase_order_id").notNull(),
  productId: uuid("product_id").notNull(),
  orderedQuantity: integer("ordered_quantity").notNull(),
  receivedQuantity: integer("received_quantity").notNull().default(0),
  notes: text("notes"),
});

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptNumber: varchar("receipt_number", { length: 100 }).notNull(),
    purchaseOrderId: uuid("purchase_order_id"),
    supplierId: uuid("supplier_id").notNull(),
    siteId: uuid("site_id").notNull(),
    storageLocationId: uuid("storage_location_id").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("Posted"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull(),
  },
  (table) => [
    uniqueIndex("goods_receipts_number_unique").on(table.receiptNumber),
    index("goods_receipts_received_id_idx").on(table.receivedAt, table.id),
  ],
);

export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    goodsReceiptId: uuid("goods_receipt_id").notNull(),
    productId: uuid("product_id").notNull(),
    batchNumber: varchar("batch_number", { length: 100 }).notNull(),
    expiryDate: date("expiry_date").notNull(),
    manufacturedDate: date("manufactured_date"),
    manufacturer: varchar("manufacturer", { length: 300 }),
    quantity: integer("quantity").notNull(),
    /** Purchase cost in VND per base unit received, before VAT. NULL means unknown, never zero. */
    unitCost: numeric("unit_cost", { precision: 18, scale: 2 }),
    notes: text("notes"),
  },
  (table) => [
    check("goods_receipt_lines_unit_cost_nonnegative", sql`${table.unitCost} is null or ${table.unitCost} >= 0`),
  ],
);

/**
 * A follow-up item for a suggestion or an alert (design 0007). The owner is an employee in identity-service, checked at
 * write time; the source reference is a stable key of the origin, unique among the plans still open or in progress.
 */
export const actionPlans = pgTable(
  "action_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceType: varchar("source_type", { length: 30 }).notNull(),
    sourceRef: varchar("source_ref", { length: 200 }).notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    detail: text("detail"),
    siteId: uuid("site_id"),
    productId: uuid("product_id"),
    ownerId: uuid("owner_id").notNull(),
    dueDate: date("due_date").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("action_plans_created_id_idx").on(table.createdAt.desc(), table.id.desc()),
    index("action_plans_owner_status_idx").on(table.ownerId, table.status),
    uniqueIndex("action_plans_live_source_unique")
      .on(table.sourceType, table.sourceRef)
      .where(sql`${table.status} <> 'done'`),
  ],
);
