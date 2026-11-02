import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

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

// Money is integer micro-USD (1 USD = 1,000,000), so no float rounding reaches the ledger.
export const aiModelPrices = pgTable(
  "ai_model_prices",
  {
    provider: varchar("provider", { length: 32 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    inputMicroUsdPerMillion: bigint("input_micro_usd_per_million", { mode: "number" }).notNull(),
    outputMicroUsdPerMillion: bigint("output_micro_usd_per_million", { mode: "number" }).notNull(),
    imageMicroUsdPerImage: bigint("image_micro_usd_per_image", { mode: "number" }),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ name: "ai_model_prices_pkey", columns: [table.provider, table.model] }),
    check(
      "ai_model_prices_nonnegative_check",
      sql`${table.inputMicroUsdPerMillion} >= 0 and ${table.outputMicroUsdPerMillion} >= 0 and (${table.imageMicroUsdPerImage} is null or ${table.imageMicroUsdPerImage} >= 0)`,
    ),
  ],
);

// One row at most. Absent row means no limit.
export const aiBudgetSettings = pgTable(
  "ai_budget_settings",
  {
    id: smallint("id").primaryKey(),
    dailyLimitMicroUsd: bigint("daily_limit_micro_usd", { mode: "number" }),
    monthlyLimitMicroUsd: bigint("monthly_limit_micro_usd", { mode: "number" }),
    updatedBy: uuid("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("ai_budget_settings_singleton_check", sql`${table.id} = 1`),
    check(
      "ai_budget_settings_nonnegative_check",
      sql`(${table.dailyLimitMicroUsd} is null or ${table.dailyLimitMicroUsd} >= 0) and (${table.monthlyLimitMicroUsd} is null or ${table.monthlyLimitMicroUsd} >= 0)`,
    ),
  ],
);

// One row per provider call. `cost_micro_usd` is null only when no price was set and no limit needed one.
export const aiUsageLedger = pgTable(
  "ai_usage_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    inputTokens: integer("input_tokens").notNull(),
    cachedInputTokens: integer("cached_input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    thoughtTokens: integer("thought_tokens").notNull(),
    modelCalls: integer("model_calls").notNull(),
    usageSource: varchar("usage_source", { length: 16, enum: ["provider", "estimated"] }).notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }),
  },
  (table) => [
    index("ai_usage_ledger_created_at_idx").on(table.createdAt),
    check("ai_usage_ledger_usage_source_check", sql`${table.usageSource} in ('provider', 'estimated')`),
  ],
);
