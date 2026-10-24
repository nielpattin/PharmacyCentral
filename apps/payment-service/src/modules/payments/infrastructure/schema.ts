import { sql } from "drizzle-orm";
import { index, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { currentTraceparent } from "../../../shared/infrastructure/trace-context.ts";

export const paymentInvoices = pgTable(
  "payment_invoices",
  {
    id: uuid("id").primaryKey(),
    paymentCode: varchar("payment_code", { length: 100 }).notNull(),
    customerId: uuid("customer_id"),
    orderId: uuid("order_id"),
    prescriptionId: uuid("prescription_id"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("VND"),
    status: varchar("status", { length: 20 }).notNull().default("Pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_invoices_code_unique").on(table.paymentCode),
    index("payment_invoices_customer_status_idx").on(table.customerId, table.status),
    index("payment_invoices_order_idx").on(table.orderId),
    index("payment_invoices_prescription_idx").on(table.prescriptionId),
    index("payment_invoices_created_id_idx").on(table.createdAt, table.id),
  ],
);

export const paymentInvoiceLines = pgTable(
  "payment_invoice_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentInvoiceId: uuid("payment_invoice_id").notNull(),
    productId: uuid("product_id").notNull(),
    productUnitId: uuid("product_unit_id").notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
  },
  (table) => [index("payment_invoice_lines_invoice_id_idx").on(table.paymentInvoiceId)],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentInvoiceId: uuid("payment_invoice_id").notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    method: varchar("method", { length: 50 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("Pending"),
    providerMetadata: text("provider_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payment_attempts_invoice_idx").on(table.paymentInvoiceId, table.createdAt)],
);

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentInvoiceId: uuid("payment_invoice_id").notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    providerTransactionId: varchar("provider_transaction_id", { length: 200 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_transactions_provider_id_unique").on(table.provider, table.providerTransactionId),
    index("payment_transactions_invoice_idx").on(table.paymentInvoiceId, table.receivedAt),
  ],
);

export const paymentRefunds = pgTable("payment_refunds", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentInvoiceId: uuid("payment_invoice_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("Completed"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reconciliationRecords = pgTable("payment_reconciliation", {
  paymentInvoiceId: uuid("payment_invoice_id").primaryKey(),
  expectedAmount: numeric("expected_amount", { precision: 18, scale: 2 }).notNull(),
  receivedAmount: numeric("received_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  state: varchar("state", { length: 30 }).notNull().default("Open"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outboxMessages = pgTable(
  "outbox_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: varchar("event_type", { length: 200 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    payload: text("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: numeric("attempts", { precision: 10, scale: 0 }).notNull().default("0"),
    /** Captured from the request's active span on insert, so the relay can publish under that trace. */
    traceparent: varchar("traceparent", { length: 200 }).$type<string | null>().$defaultFn(currentTraceparent),
  },
  (table) => [
    index("outbox_messages_unpublished_idx")
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);
