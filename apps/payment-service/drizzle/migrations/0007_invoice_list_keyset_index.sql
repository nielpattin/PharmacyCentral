CREATE INDEX "payment_invoices_created_id_idx" ON "payment_invoices" USING btree ("created_at","id");
