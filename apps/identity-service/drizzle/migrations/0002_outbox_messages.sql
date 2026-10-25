CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(200) NOT NULL,
	"schema_version" varchar(20) NOT NULL,
	"payload" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "outbox_messages_unpublished_idx" ON "outbox_messages" USING btree ("occurred_at") WHERE "outbox_messages"."published_at" is null;