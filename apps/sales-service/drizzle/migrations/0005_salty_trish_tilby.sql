CREATE TABLE "prescription_consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"site_id" uuid,
	"source" varchar(10) NOT NULL,
	"prescription" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"note" text,
	"status" varchar(20) DEFAULT 'Open' NOT NULL,
	"reply" text,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "prescription_consultations_customer_created_idx" ON "prescription_consultations" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "prescription_consultations_status_created_idx" ON "prescription_consultations" USING btree ("status","created_at");