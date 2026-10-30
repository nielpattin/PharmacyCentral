CREATE TABLE "sales_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'VND' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sales_targets_site_month_unique" ON "sales_targets" USING btree ("site_id","month");--> statement-breakpoint
CREATE INDEX "sales_targets_month_idx" ON "sales_targets" USING btree ("month");