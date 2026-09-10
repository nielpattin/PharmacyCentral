CREATE TABLE "payment_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_code" varchar(100) NOT NULL,
	"customer_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'VND' NOT NULL,
	"status" varchar(20) DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_invoice_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_transaction_id" varchar(200) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_invoices_code_unique" ON "payment_invoices" USING btree ("payment_code");--> statement-breakpoint
CREATE INDEX "payment_invoices_customer_status_idx" ON "payment_invoices" USING btree ("customer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_provider_id_unique" ON "payment_transactions" USING btree ("provider","provider_transaction_id");