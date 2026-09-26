ALTER TABLE "delivery_addresses" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_addresses_customer_default_unique" ON "delivery_addresses" USING btree ("customer_id") WHERE "delivery_addresses"."is_default";--> statement-breakpoint
CREATE INDEX "prescriptions_customer_created_idx" ON "prescriptions" USING btree ("customer_id","created_at");