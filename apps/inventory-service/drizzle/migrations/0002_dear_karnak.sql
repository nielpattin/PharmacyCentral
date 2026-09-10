ALTER TABLE "replenishment_requests" ADD COLUMN "product_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "replenishment_requests" ADD COLUMN "storage_location_id" uuid;--> statement-breakpoint
ALTER TABLE "return_lines" ADD COLUMN "storage_location_id" uuid;--> statement-breakpoint
ALTER TABLE "transfer_order_lines" ADD COLUMN "product_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "transfer_order_lines" ADD COLUMN "source_storage_location_id" uuid;--> statement-breakpoint
ALTER TABLE "transfer_order_lines" ADD COLUMN "destination_storage_location_id" uuid;