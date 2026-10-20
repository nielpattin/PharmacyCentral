import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import type { ChatProductRef } from "../../contracts/chat.ts";

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

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chat_sessions_customer_id_idx").on(table.customerId)],
);

// PostgreSQL now() is the transaction start time, so both rows of one exchange share created_at. seq orders them.
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16, enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    products: jsonb("products").$type<ChatProductRef[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_session_seq_idx").on(table.sessionId, table.seq),
    check("chat_messages_role_check", sql`${table.role} in ('user', 'assistant')`),
  ],
);
