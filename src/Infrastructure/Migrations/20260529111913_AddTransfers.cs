using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PharmacyCentral.Infrastructure.Migrations;

/// <inheritdoc />
public partial class AddTransfers : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "transfer_orders",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                transfer_number = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                source_site_id = table.Column<Guid>(type: "uuid", nullable: false),
                source_storage_location_id = table.Column<Guid>(type: "uuid", nullable: false),
                destination_site_id = table.Column<Guid>(type: "uuid", nullable: false),
                destination_storage_location_id = table.Column<Guid>(type: "uuid", nullable: false),
                status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                approved_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                approved_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                shipped_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                received_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_transfer_orders", x => x.id);
                table.ForeignKey(
                    name: "FK_transfer_orders_sites_destination_site_id",
                    column: x => x.destination_site_id,
                    principalTable: "sites",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_transfer_orders_sites_source_site_id",
                    column: x => x.source_site_id,
                    principalTable: "sites",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_transfer_orders_storage_locations_destination_storage_locat~",
                    column: x => x.destination_storage_location_id,
                    principalTable: "storage_locations",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_transfer_orders_storage_locations_source_storage_location_id",
                    column: x => x.source_storage_location_id,
                    principalTable: "storage_locations",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "transfer_order_lines",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                transfer_order_id = table.Column<Guid>(type: "uuid", nullable: false),
                product_id = table.Column<Guid>(type: "uuid", nullable: false),
                product_batch_id = table.Column<Guid>(type: "uuid", nullable: false),
                requested_quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                shipped_quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                received_quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_transfer_order_lines", x => x.id);
                table.ForeignKey(
                    name: "FK_transfer_order_lines_product_batches_product_batch_id",
                    column: x => x.product_batch_id,
                    principalTable: "product_batches",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_transfer_order_lines_products_product_id",
                    column: x => x.product_id,
                    principalTable: "products",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_transfer_order_lines_transfer_orders_transfer_order_id",
                    column: x => x.transfer_order_id,
                    principalTable: "transfer_orders",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_transfer_order_lines_product_batch_id",
            table: "transfer_order_lines",
            column: "product_batch_id");

        migrationBuilder.CreateIndex(
            name: "IX_transfer_order_lines_product_id",
            table: "transfer_order_lines",
            column: "product_id");

        migrationBuilder.CreateIndex(
            name: "IX_transfer_order_lines_transfer_order_id",
            table: "transfer_order_lines",
            column: "transfer_order_id");

        migrationBuilder.CreateIndex(
            name: "IX_transfer_orders_destination_site_id_status",
            table: "transfer_orders",
            columns: new[] { "destination_site_id", "status" });

        migrationBuilder.CreateIndex(
            name: "IX_transfer_orders_destination_storage_location_id",
            table: "transfer_orders",
            column: "destination_storage_location_id");

        migrationBuilder.CreateIndex(
            name: "IX_transfer_orders_source_site_id_status",
            table: "transfer_orders",
            columns: new[] { "source_site_id", "status" });

        migrationBuilder.CreateIndex(
            name: "IX_transfer_orders_source_storage_location_id",
            table: "transfer_orders",
            column: "source_storage_location_id");

        migrationBuilder.CreateIndex(
            name: "IX_transfer_orders_transfer_number",
            table: "transfer_orders",
            column: "transfer_number",
            unique: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "transfer_order_lines");

        migrationBuilder.DropTable(
            name: "transfer_orders");
    }
}
