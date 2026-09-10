ALTER TABLE "replenishment_request_lines" ALTER COLUMN "product_batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_batches" ADD COLUMN "manufacturer" varchar(300);--> statement-breakpoint
ALTER TABLE "product_batches" ADD COLUMN "status" varchar(30) DEFAULT 'Active' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_batches" ADD COLUMN "quality_reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "product_batches" ADD COLUMN "quality_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_batches" ADD COLUMN "quality_notes" text;--> statement-breakpoint
ALTER TABLE "replenishment_requests" ADD COLUMN "request_number" varchar(100);--> statement-breakpoint
ALTER TABLE "replenishment_requests" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "replenishment_requests" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "replenishment_requests" ADD COLUMN "review_notes" text;--> statement-breakpoint
ALTER TABLE "return_lines" ADD COLUMN "destination" text;--> statement-breakpoint
ALTER TABLE "return_lines" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "return_lines" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "stocktake_session_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_ledger_entries" ADD COLUMN "reference_type" varchar(80);--> statement-breakpoint
ALTER TABLE "stock_ledger_entries" ADD COLUMN "reference_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_ledger_entries" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "stock_ledger_entries" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_ledger_entries" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stocktakes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "transfer_order_lines" ADD COLUMN "requested_quantity" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "transfer_order_lines" ADD COLUMN "shipped_quantity" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfer_order_lines" ADD COLUMN "received_quantity" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfer_order_lines" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD COLUMN "source_storage_location_id" uuid;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD COLUMN "destination_storage_location_id" uuid;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD COLUMN "received_at" timestamp with time zone;