CREATE TABLE "idempotency_records" (
	"key" varchar(128) NOT NULL,
	"scope" varchar(200) NOT NULL,
	"actor_id" uuid,
	"response" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(200) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_batch_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"quantity_on_hand" numeric(18, 6) DEFAULT '0' NOT NULL,
	"quantity_reserved" numeric(18, 6) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(200) NOT NULL,
	"schema_version" varchar(20) NOT NULL,
	"payload" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_id" uuid,
	"batch_number" varchar(100) NOT NULL,
	"manufactured_date" date,
	"expiry_date" date NOT NULL,
	"quality_status" varchar(20) DEFAULT 'PendingQc' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"product_batch_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"quantity_delta" numeric(18, 6) NOT NULL,
	"quantity_after" numeric(18, 6) NOT NULL,
	"movement_type" varchar(80) NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_actor_unique" ON "idempotency_records" USING btree ("scope","key","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_balance_batch_location_unique" ON "inventory_balances" USING btree ("product_batch_id","storage_location_id");--> statement-breakpoint
CREATE INDEX "inventory_balance_product_site_idx" ON "inventory_balances" USING btree ("product_batch_id","site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_batches_product_number_unique" ON "product_batches" USING btree ("product_id","batch_number");--> statement-breakpoint
CREATE INDEX "stock_ledger_product_occurred_idx" ON "stock_ledger_entries" USING btree ("product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_reservations_owner_idx" ON "stock_reservations" USING btree ("owner_id","status");