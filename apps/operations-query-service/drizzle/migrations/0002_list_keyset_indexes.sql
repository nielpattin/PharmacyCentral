CREATE INDEX "audit_events_keyset_idx" ON "audit_events" USING btree ("occurred_at","event_id");--> statement-breakpoint
CREATE INDEX "report_rows_keyset_idx" ON "report_rows" USING btree ("occurred_at","id");
