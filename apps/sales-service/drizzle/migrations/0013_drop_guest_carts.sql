DELETE FROM "cart_lines" WHERE "cart_id" IN (SELECT "id" FROM "carts" WHERE "customer_id" IS NULL);--> statement-breakpoint
DELETE FROM "carts" WHERE "customer_id" IS NULL;--> statement-breakpoint
DROP INDEX "carts_guest_token_unique";--> statement-breakpoint
ALTER TABLE "carts" ALTER COLUMN "customer_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "carts" DROP COLUMN "guest_token_digest";