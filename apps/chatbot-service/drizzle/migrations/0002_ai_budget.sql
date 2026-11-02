CREATE TABLE "ai_budget_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"daily_limit_micro_usd" bigint,
	"monthly_limit_micro_usd" bigint,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_budget_settings_singleton_check" CHECK ("ai_budget_settings"."id" = 1),
	CONSTRAINT "ai_budget_settings_nonnegative_check" CHECK (("ai_budget_settings"."daily_limit_micro_usd" is null or "ai_budget_settings"."daily_limit_micro_usd" >= 0) and ("ai_budget_settings"."monthly_limit_micro_usd" is null or "ai_budget_settings"."monthly_limit_micro_usd" >= 0))
);
--> statement-breakpoint
CREATE TABLE "ai_model_prices" (
	"provider" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"input_micro_usd_per_million" bigint NOT NULL,
	"output_micro_usd_per_million" bigint NOT NULL,
	"image_micro_usd_per_image" bigint,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_model_prices_pkey" PRIMARY KEY("provider","model"),
	CONSTRAINT "ai_model_prices_nonnegative_check" CHECK ("ai_model_prices"."input_micro_usd_per_million" >= 0 and "ai_model_prices"."output_micro_usd_per_million" >= 0 and ("ai_model_prices"."image_micro_usd_per_image" is null or "ai_model_prices"."image_micro_usd_per_image" >= 0))
);
--> statement-breakpoint
CREATE TABLE "ai_usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"input_tokens" integer NOT NULL,
	"cached_input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"thought_tokens" integer NOT NULL,
	"model_calls" integer NOT NULL,
	"usage_source" varchar(16) NOT NULL,
	"cost_micro_usd" bigint,
	CONSTRAINT "ai_usage_ledger_usage_source_check" CHECK ("ai_usage_ledger"."usage_source" in ('provider', 'estimated'))
);
--> statement-breakpoint
CREATE INDEX "ai_usage_ledger_created_at_idx" ON "ai_usage_ledger" USING btree ("created_at");