using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PharmacyCentral.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddStockReservationsAndIdempotency : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "idempotency_records",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    scope = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status_code = table.Column<int>(type: "integer", nullable: false),
                    response_body = table.Column<string>(type: "text", nullable: false),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_idempotency_records", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "stock_reservations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    prescription_id = table.Column<Guid>(type: "uuid", nullable: false),
                    prescription_line_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_batch_id = table.Column<Guid>(type: "uuid", nullable: false),
                    site_id = table.Column<Guid>(type: "uuid", nullable: false),
                    storage_location_id = table.Column<Guid>(type: "uuid", nullable: false),
                    quantity_reserved = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    quantity_consumed = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    released_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    consumed_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_stock_reservations", x => x.id);
                    table.ForeignKey(
                        name: "FK_stock_reservations_prescription_lines_prescription_line_id",
                        column: x => x.prescription_line_id,
                        principalTable: "prescription_lines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_stock_reservations_prescriptions_prescription_id",
                        column: x => x.prescription_id,
                        principalTable: "prescriptions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_stock_reservations_product_batches_product_batch_id",
                        column: x => x.product_batch_id,
                        principalTable: "product_batches",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_stock_reservations_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_stock_reservations_sites_site_id",
                        column: x => x.site_id,
                        principalTable: "sites",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_stock_reservations_storage_locations_storage_location_id",
                        column: x => x.storage_location_id,
                        principalTable: "storage_locations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_idempotency_records_key_scope_user_id",
                table: "idempotency_records",
                columns: new[] { "key", "scope", "user_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_stock_reservations_prescription_id",
                table: "stock_reservations",
                column: "prescription_id");

            migrationBuilder.CreateIndex(
                name: "IX_stock_reservations_prescription_line_id",
                table: "stock_reservations",
                column: "prescription_line_id");

            migrationBuilder.CreateIndex(
                name: "IX_stock_reservations_product_batch_id_site_id_storage_locatio~",
                table: "stock_reservations",
                columns: new[] { "product_batch_id", "site_id", "storage_location_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_stock_reservations_product_id",
                table: "stock_reservations",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "IX_stock_reservations_site_id",
                table: "stock_reservations",
                column: "site_id");

            migrationBuilder.CreateIndex(
                name: "IX_stock_reservations_storage_location_id",
                table: "stock_reservations",
                column: "storage_location_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "idempotency_records");

            migrationBuilder.DropTable(
                name: "stock_reservations");
        }
    }
}
