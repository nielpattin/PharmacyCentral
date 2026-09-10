CREATE TABLE "sales_idempotency_records" (
	"key" varchar(128) NOT NULL,
	"scope" varchar(200) NOT NULL,
	"actor_id" uuid NOT NULL,
	"response" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_idempotency_scope_key_actor_unique" ON "sales_idempotency_records" USING btree ("scope","key","actor_id");