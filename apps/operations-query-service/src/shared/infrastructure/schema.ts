import { index, integer, numeric, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const auditEvents = pgTable(
  "audit_events",
  {
    eventId: uuid("event_id").primaryKey(),
    actorId: uuid("actor_id"),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id"),
    siteId: uuid("site_id"),
    payload: text("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("audit_events_entity_idx").on(table.entityType, table.entityId, table.occurredAt),
    index("audit_events_site_idx").on(table.siteId, table.occurredAt),
    index("audit_events_actor_idx").on(table.actorId, table.occurredAt),
  ],
);

export const projectionCounters = pgTable("projection_counters", {
  key: varchar("key", { length: 200 }).primaryKey(),
  value: integer("value").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeEntries = pgTable(
  "finance_entries",
  {
    eventId: uuid("event_id").primaryKey(),
    entryType: varchar("entry_type", { length: 30 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("VND"),
    payload: text("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("finance_entries_occurred_idx").on(table.occurredAt),
    index("finance_entries_type_idx").on(table.entryType, table.occurredAt),
  ],
);

export const reportRows = pgTable(
  "report_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").notNull(),
    reportType: varchar("report_type", { length: 80 }).notNull(),
    subjectId: uuid("subject_id"),
    value: numeric("value", { precision: 18, scale: 6 }).notNull().default("0"),
    payload: text("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("report_rows_type_occurred_idx").on(table.reportType, table.occurredAt),
    index("report_rows_subject_idx").on(table.subjectId, table.occurredAt),
  ],
);
