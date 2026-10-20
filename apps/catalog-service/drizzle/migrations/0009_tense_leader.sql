CREATE TABLE "search_synonym_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"terms" jsonb NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "search_synonym_groups_status_check" CHECK ("search_synonym_groups"."status" IN ('pending', 'approved')),
	CONSTRAINT "search_synonym_groups_review_check" CHECK (("search_synonym_groups"."status" = 'approved' AND "search_synonym_groups"."approved_by" IS NOT NULL AND "search_synonym_groups"."approved_at" IS NOT NULL)
        OR ("search_synonym_groups"."status" = 'pending' AND "search_synonym_groups"."approved_by" IS NULL AND "search_synonym_groups"."approved_at" IS NULL))
);
