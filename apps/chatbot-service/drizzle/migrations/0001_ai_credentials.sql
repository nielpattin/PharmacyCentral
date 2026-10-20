CREATE TABLE "ai_credentials" (
	"purpose" varchar(32) PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"base_url" varchar(512) NOT NULL,
	"ciphertext" text NOT NULL,
	"last4" varchar(4) NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
