CREATE TABLE "replenishment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"requested_quantity" numeric(18, 6) NOT NULL,
	"status" varchar(20) DEFAULT 'Pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_request_id" uuid NOT NULL,
	"product_batch_id" uuid NOT NULL,
	"quantity" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'Pending' NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_reservation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_batch_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"quantity" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocktake_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"product_batch_id" uuid NOT NULL,
	"system_quantity" numeric(18, 6) NOT NULL,
	"counted_quantity" numeric(18, 6),
	"status" varchar(20) DEFAULT 'Pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocktakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'Pending' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_number" varchar(100) NOT NULL,
	"source_site_id" uuid NOT NULL,
	"destination_site_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'PendingApproval' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_orders_number_unique" ON "transfer_orders" USING btree ("transfer_number");