CREATE TABLE "order_idempotency_keys" (
	"customer_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"order_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_idempotency_keys" ADD CONSTRAINT "order_idempotency_keys_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_idempotency_keys_customer_key_unique" ON "order_idempotency_keys" USING btree ("customer_id","key");--> statement-breakpoint
CREATE INDEX "order_idempotency_keys_created_at_idx" ON "order_idempotency_keys" USING btree ("created_at");