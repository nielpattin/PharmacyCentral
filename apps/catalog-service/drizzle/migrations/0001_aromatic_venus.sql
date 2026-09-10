ALTER TABLE "products" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "manufacturer" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "published_by" uuid;--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "product_prices" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_units" ADD COLUMN "barcode" varchar(100);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "status" varchar(30) DEFAULT 'Active' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "status" varchar(30) DEFAULT 'Active' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD COLUMN "status" varchar(30) DEFAULT 'Active' NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD COLUMN "capacity" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "storage_locations" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "status" varchar(30) DEFAULT 'Active' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "notes" text;