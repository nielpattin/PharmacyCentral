ALTER TABLE "payment_invoices" ADD COLUMN "prescription_id" uuid;--> statement-breakpoint
CREATE INDEX "payment_invoices_prescription_idx" ON "payment_invoices" USING btree ("prescription_id");