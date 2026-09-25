ALTER TABLE "products" ADD COLUMN "generic_name" varchar(300);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "active_ingredient" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "strength" varchar(150);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "dosage_form" varchar(150);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "package_description" varchar(500);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "registration_number" varchar(100);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "prescription_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image_url" text;