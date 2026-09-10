CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(200) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" numeric(10, 0) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_invoice_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"method" varchar(50) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'Pending' NOT NULL,
	"provider_metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_invoice_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'Completed' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_reconciliation" (
	"payment_invoice_id" uuid PRIMARY KEY NOT NULL,
	"expected_amount" numeric(18, 2) NOT NULL,
	"received_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"state" varchar(30) DEFAULT 'Open' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_invoices" ADD COLUMN "order_id" uuid;--> statement-breakpoint
CREATE INDEX "payment_attempts_invoice_idx" ON "payment_attempts" USING btree ("payment_invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_invoices_order_idx" ON "payment_invoices" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_invoice_idx" ON "payment_transactions" USING btree ("payment_invoice_id","received_at");