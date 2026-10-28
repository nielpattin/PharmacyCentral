CREATE TABLE "action_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"source_ref" varchar(200) NOT NULL,
	"title" varchar(300) NOT NULL,
	"detail" text,
	"site_id" uuid,
	"product_id" uuid,
	"owner_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "action_plans_created_id_idx" ON "action_plans" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "action_plans_owner_status_idx" ON "action_plans" USING btree ("owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "action_plans_live_source_unique" ON "action_plans" USING btree ("source_type","source_ref") WHERE "action_plans"."status" <> 'done';