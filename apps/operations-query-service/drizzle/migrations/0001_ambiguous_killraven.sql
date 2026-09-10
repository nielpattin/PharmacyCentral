CREATE TABLE "finance_entries" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"entry_type" varchar(30) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'VND' NOT NULL,
	"payload" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"report_type" varchar(80) NOT NULL,
	"subject_id" uuid,
	"value" numeric(18, 6) DEFAULT '0' NOT NULL,
	"payload" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "finance_entries_occurred_idx" ON "finance_entries" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "finance_entries_type_idx" ON "finance_entries" USING btree ("entry_type","occurred_at");--> statement-breakpoint
CREATE INDEX "report_rows_type_occurred_idx" ON "report_rows" USING btree ("report_type","occurred_at");--> statement-breakpoint
CREATE INDEX "report_rows_subject_idx" ON "report_rows" USING btree ("subject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_site_idx" ON "audit_events" USING btree ("site_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id","occurred_at");