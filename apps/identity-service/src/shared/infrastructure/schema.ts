import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorType: varchar("actor_type", { length: 20 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 50 }),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull(),
    roleName: varchar("role_name", { length: 100 }).notNull(),
  },
  (table) => [uniqueIndex("user_roles_user_role_unique").on(table.userId, table.roleName)],
);

export const userSiteScopes = pgTable(
  "user_site_scopes",
  {
    userId: uuid("user_id").notNull(),
    siteId: uuid("site_id").notNull(),
  },
  (table) => [uniqueIndex("user_site_scopes_user_site_unique").on(table.userId, table.siteId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    tokenDigest: varchar("token_digest", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sessions_token_digest_unique").on(table.tokenDigest),
    index("sessions_user_active_idx").on(table.userId, table.revokedAt),
  ],
);

export const oneTimeTokens = pgTable("one_time_tokens", {
  digest: varchar("digest", { length: 128 }).primaryKey(),
  userId: uuid("user_id").notNull(),
  purpose: varchar("purpose", { length: 40 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
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
  },
  (table) => [
    index("outbox_messages_unpublished_idx")
      .on(table.occurredAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);
