ALTER TABLE "orders" ADD COLUMN "payment_method" varchar(30);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stock_hold" varchar(20) DEFAULT 'none' NOT NULL;