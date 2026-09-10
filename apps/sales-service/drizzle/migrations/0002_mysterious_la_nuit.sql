ALTER TABLE "prescriptions" ADD COLUMN "prescription_number" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "dispensed_by" uuid;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "dispensed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "prescriptions_number_unique" ON "prescriptions" USING btree ("prescription_number");