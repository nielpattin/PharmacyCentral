CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "availability_projections" (
	"product_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"in_stock" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(200) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"product_unit_id" uuid NOT NULL,
	"site_id" uuid,
	"unit_price" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'VND' NOT NULL,
	"status" varchar(20) DEFAULT 'Draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_name" varchar(100) NOT NULL,
	"conversion_factor_to_base_unit" numeric(18, 6) NOT NULL,
	"is_base_unit" boolean DEFAULT false NOT NULL,
	"is_default_sale_unit" boolean DEFAULT false NOT NULL,
	"is_default_purchase_unit" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" varchar(100) NOT NULL,
	"barcode" varchar(100),
	"name" varchar(300) NOT NULL,
	"category" varchar(150) NOT NULL,
	"manufacturer" varchar(300) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"site_type" varchar(50) NOT NULL,
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_customer_facing" boolean DEFAULT false NOT NULL,
	"location" geometry(point),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"location_type" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(300) NOT NULL,
	"contact_name" varchar(200),
	"email" varchar(320),
	"phone" varchar(50),
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "availability_product_site_unique" ON "availability_projections" USING btree ("product_id","site_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_messages" USING btree ("published_at","occurred_at");--> statement-breakpoint
CREATE INDEX "product_prices_lookup_idx" ON "product_prices" USING btree ("product_id","product_unit_id","site_id","status","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "product_units_product_name_unique" ON "product_units" USING btree ("product_id","unit_name");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_unique" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "products_barcode_unique" ON "products" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_code_unique" ON "sites" USING btree ("code");--> statement-breakpoint
CREATE INDEX "sites_location_gist" ON "sites" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_locations_site_code_unique" ON "storage_locations" USING btree ("site_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_code_unique" ON "suppliers" USING btree ("code");