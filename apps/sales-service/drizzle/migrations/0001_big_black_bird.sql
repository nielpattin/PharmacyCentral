CREATE TABLE "delivery_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" varchar(100) NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"provider_resolved_address" text NOT NULL,
	"address_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(200) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescription_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_unit_id" uuid NOT NULL,
	"prescribed_quantity" numeric(18, 6) NOT NULL,
	"dispensed_quantity" numeric(18, 6) DEFAULT '0' NOT NULL,
	"product_batch_id" uuid,
	"dosage" text,
	"frequency" text,
	"duration" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"patient_name" varchar(200) NOT NULL,
	"patient_phone" varchar(50),
	"doctor_name" varchar(200),
	"doctor_license" varchar(100),
	"notes" text,
	"status" varchar(30) DEFAULT 'Draft' NOT NULL,
	"reservation_id" uuid,
	"created_by" uuid NOT NULL,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_delivery_snapshots" ADD COLUMN "selected_store_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_status" varchar(20) DEFAULT 'Pending' NOT NULL;--> statement-breakpoint
CREATE INDEX "delivery_addresses_customer_idx" ON "delivery_addresses" USING btree ("customer_id","updated_at");--> statement-breakpoint
CREATE INDEX "prescriptions_site_status_idx" ON "prescriptions" USING btree ("site_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_lines_cart_product_unit_unique" ON "cart_lines" USING btree ("cart_id","product_id","product_unit_id");--> statement-breakpoint
CREATE INDEX "orders_customer_created_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_store_status_idx" ON "orders" USING btree ("selected_store_id","status");