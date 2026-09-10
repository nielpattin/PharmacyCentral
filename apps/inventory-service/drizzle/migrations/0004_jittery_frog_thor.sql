CREATE TABLE "replenishment_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replenishment_request_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_batch_id" uuid NOT NULL,
	"requested_quantity" numeric(18, 6) NOT NULL,
	"reason" varchar(80),
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "replenishment_requests" ADD COLUMN "notes" text;
--> statement-breakpoint
INSERT INTO "replenishment_request_lines" ("replenishment_request_id", "product_id", "product_batch_id", "requested_quantity")
SELECT "id", "product_id", "product_batch_id", "requested_quantity"
FROM "replenishment_requests"
WHERE "product_batch_id" IS NOT NULL;