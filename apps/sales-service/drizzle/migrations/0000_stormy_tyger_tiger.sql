CREATE TABLE "cart_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_unit_id" uuid NOT NULL,
	"quantity" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"guest_token_digest" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_delivery_snapshots" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"origin_latitude" numeric(10, 7) NOT NULL,
	"origin_longitude" numeric(10, 7) NOT NULL,
	"destination_latitude" numeric(10, 7) NOT NULL,
	"destination_longitude" numeric(10, 7) NOT NULL,
	"provider_resolved_address" text NOT NULL,
	"address_note" text,
	"distance_meters" numeric(18, 2) NOT NULL,
	"duration_seconds" numeric(18, 2) NOT NULL,
	"route_geo_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_unit_id" uuid NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"unit_price_snapshot" numeric(18, 2) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'Pending' NOT NULL,
	"fulfillment_type" varchar(20) NOT NULL,
	"selected_store_id" uuid NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"delivery_fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'VND' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "carts_customer_unique" ON "carts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_guest_token_unique" ON "carts" USING btree ("guest_token_digest");