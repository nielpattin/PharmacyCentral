CREATE TABLE "disposal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"disposal_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_batch_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"quantity" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disposal_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"reason" varchar(20) NOT NULL,
	"note" text,
	"status" varchar(20) DEFAULT 'PendingApproval' NOT NULL,
	"created_by" uuid NOT NULL,
	"decided_by" uuid,
	"decision_notes" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "disposal_lines_batch_location_unique" ON "disposal_lines" USING btree ("disposal_id","product_batch_id","storage_location_id");--> statement-breakpoint
CREATE INDEX "disposal_lines_disposal_idx" ON "disposal_lines" USING btree ("disposal_id");--> statement-breakpoint
CREATE INDEX "disposal_records_site_created_idx" ON "disposal_records" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "disposal_records_created_id_idx" ON "disposal_records" USING btree ("created_at","id");