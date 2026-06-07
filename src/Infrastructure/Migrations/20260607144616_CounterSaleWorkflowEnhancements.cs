using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PharmacyCentral.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class CounterSaleWorkflowEnhancements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "barcode",
                table: "products",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "customer_profile_id",
                table: "prescriptions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "refund_reason",
                table: "payment_invoices",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "refunded_at_utc",
                table: "payment_invoices",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "refunded_by_user_id",
                table: "payment_invoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "customer_profiles",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    phone_number = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    normalized_phone_number = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_customer_profiles", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "replenishment_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    request_number = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    site_id = table.Column<Guid>(type: "uuid", nullable: false),
                    storage_location_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    requested_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    reviewed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    reviewed_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    review_notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_replenishment_requests", x => x.id);
                    table.ForeignKey(
                        name: "FK_replenishment_requests_sites_site_id",
                        column: x => x.site_id,
                        principalTable: "sites",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_replenishment_requests_storage_locations_storage_location_id",
                        column: x => x.storage_location_id,
                        principalTable: "storage_locations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "replenishment_request_lines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    replenishment_request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    requested_quantity = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    reason = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_replenishment_request_lines", x => x.id);
                    table.ForeignKey(
                        name: "FK_replenishment_request_lines_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_replenishment_request_lines_replenishment_requests_replenis~",
                        column: x => x.replenishment_request_id,
                        principalTable: "replenishment_requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_products_barcode",
                table: "products",
                column: "barcode",
                unique: true,
                filter: "barcode IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_prescriptions_customer_profile_id",
                table: "prescriptions",
                column: "customer_profile_id");

            migrationBuilder.CreateIndex(
                name: "IX_customer_profiles_normalized_phone_number",
                table: "customer_profiles",
                column: "normalized_phone_number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_replenishment_request_lines_product_id",
                table: "replenishment_request_lines",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "IX_replenishment_request_lines_replenishment_request_id_produc~",
                table: "replenishment_request_lines",
                columns: new[] { "replenishment_request_id", "product_id" });

            migrationBuilder.CreateIndex(
                name: "IX_replenishment_requests_request_number",
                table: "replenishment_requests",
                column: "request_number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_replenishment_requests_site_id_status",
                table: "replenishment_requests",
                columns: new[] { "site_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_replenishment_requests_storage_location_id",
                table: "replenishment_requests",
                column: "storage_location_id");

            migrationBuilder.AddForeignKey(
                name: "FK_prescriptions_customer_profiles_customer_profile_id",
                table: "prescriptions",
                column: "customer_profile_id",
                principalTable: "customer_profiles",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_prescriptions_customer_profiles_customer_profile_id",
                table: "prescriptions");

            migrationBuilder.DropTable(
                name: "customer_profiles");

            migrationBuilder.DropTable(
                name: "replenishment_request_lines");

            migrationBuilder.DropTable(
                name: "replenishment_requests");

            migrationBuilder.DropIndex(
                name: "IX_products_barcode",
                table: "products");

            migrationBuilder.DropIndex(
                name: "IX_prescriptions_customer_profile_id",
                table: "prescriptions");

            migrationBuilder.DropColumn(
                name: "barcode",
                table: "products");

            migrationBuilder.DropColumn(
                name: "customer_profile_id",
                table: "prescriptions");

            migrationBuilder.DropColumn(
                name: "refund_reason",
                table: "payment_invoices");

            migrationBuilder.DropColumn(
                name: "refunded_at_utc",
                table: "payment_invoices");

            migrationBuilder.DropColumn(
                name: "refunded_by_user_id",
                table: "payment_invoices");
        }
    }
}
