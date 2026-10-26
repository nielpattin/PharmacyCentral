ALTER TABLE "product_batches" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "stocktake_lines" ADD COLUMN "counted_by" uuid;