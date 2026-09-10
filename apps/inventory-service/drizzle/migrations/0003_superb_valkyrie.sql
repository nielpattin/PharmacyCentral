CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"product_batch_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"adjustment_type" varchar(20) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'Pending' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approval_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
