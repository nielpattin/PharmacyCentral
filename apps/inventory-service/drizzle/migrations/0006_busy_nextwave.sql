ALTER TABLE "replenishment_requests" ALTER COLUMN "storage_location_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "replenishment_requests" DROP COLUMN "product_id";--> statement-breakpoint
ALTER TABLE "replenishment_requests" DROP COLUMN "product_batch_id";--> statement-breakpoint
ALTER TABLE "replenishment_requests" DROP COLUMN "request_number";--> statement-breakpoint
ALTER TABLE "replenishment_requests" DROP COLUMN "requested_quantity";