CREATE INDEX "product_batches_expiry_id_idx" ON "product_batches" USING btree ("expiry_date","id");--> statement-breakpoint
CREATE INDEX "stock_adjustments_created_id_idx" ON "stock_adjustments" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "stock_ledger_entries_occurred_id_idx" ON "stock_ledger_entries" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "transfer_orders_created_id_idx" ON "transfer_orders" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "purchase_orders_created_id_idx" ON "purchase_orders" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "goods_receipts_received_id_idx" ON "goods_receipts" USING btree ("received_at","id");--> statement-breakpoint
CREATE INDEX "replenishment_requests_created_id_idx" ON "replenishment_requests" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "stocktakes_created_id_idx" ON "stocktakes" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "return_requests_created_id_idx" ON "return_requests" USING btree ("created_at","id");
