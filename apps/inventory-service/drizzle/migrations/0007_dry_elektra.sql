CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_number" varchar(100) NOT NULL,
	"expiry_date" date NOT NULL,
	"manufactured_date" date,
	"manufacturer" varchar(300),
	"quantity" integer NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_number" varchar(100) NOT NULL,
	"purchase_order_id" uuid,
	"supplier_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'Posted' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"ordered_quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_number" varchar(100) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"expected_date" date,
	"status" varchar(30) DEFAULT 'Draft' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"cancelled_by" uuid,
	"approved_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipts_number_unique" ON "goods_receipts" USING btree ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_number_unique" ON "purchase_orders" USING btree ("purchase_order_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_site_status_idx" ON "purchase_orders" USING btree ("site_id","status");