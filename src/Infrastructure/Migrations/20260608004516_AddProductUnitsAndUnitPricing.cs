using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PharmacyCentral.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddProductUnitsAndUnitPricing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_product_prices_product_id_site_id_status_effective_from",
                table: "product_prices");

            migrationBuilder.CreateTable(
                name: "product_units",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    unit_name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    conversion_factor_to_base_unit = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    is_base_unit = table.Column<bool>(type: "boolean", nullable: false),
                    is_default_sale_unit = table.Column<bool>(type: "boolean", nullable: false),
                    is_default_purchase_unit = table.Column<bool>(type: "boolean", nullable: false),
                    barcode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_product_units", x => x.id);
                    table.ForeignKey(
                        name: "FK_product_units_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.Sql("""
                INSERT INTO product_units (id, product_id, unit_name, conversion_factor_to_base_unit, is_base_unit, is_default_sale_unit, is_default_purchase_unit, sort_order, created_at_utc, updated_at_utc)
                SELECT gen_random_uuid(), id,
                    CASE
                        WHEN unit ILIKE '%viên%' OR unit ILIKE '%vỉ%' OR unit ILIKE '%hộp%' THEN 'Viên'
                        WHEN unit ILIKE '%cái%' THEN 'Cái'
                        WHEN unit ILIKE '%miếng%' THEN 'Miếng'
                        WHEN unit ILIKE '%ống%' THEN 'Ống'
                        WHEN unit ILIKE '%chai%' THEN 'Chai'
                        WHEN unit ILIKE '%tuýp%' THEN 'Tuýp'
                        WHEN unit ILIKE '%gói%' THEN 'Gói'
                        ELSE COALESCE(NULLIF(split_part(unit, ' ', 1), ''), 'Viên')
                    END,
                    1, true, true, false, 1, now(), now()
                FROM products
                WHERE NOT EXISTS (SELECT 1 FROM product_units WHERE product_units.product_id = products.id AND product_units.is_base_unit = true);
                """);

            migrationBuilder.Sql("""
                INSERT INTO product_units (id, product_id, unit_name, conversion_factor_to_base_unit, is_base_unit, is_default_sale_unit, is_default_purchase_unit, sort_order, created_at_utc, updated_at_utc)
                SELECT gen_random_uuid(), id, 'Vỉ',
                    CASE
                        WHEN unit ~ 'vỉ x 6 viên' THEN 6
                        WHEN unit ~ 'vỉ x 10 viên' THEN 10
                        WHEN unit ~ 'Vỉ 6 viên' THEN 6
                        WHEN unit ~ 'Vỉ 10 viên' THEN 10
                        ELSE 10
                    END,
                    false, true, false, 2, now(), now()
                FROM products
                WHERE COALESCE(unit, '') ILIKE '%vỉ%'
                  AND NOT EXISTS (SELECT 1 FROM product_units WHERE product_units.product_id = products.id AND product_units.unit_name = 'Vỉ');
                """);

            migrationBuilder.Sql("""
                INSERT INTO product_units (id, product_id, unit_name, conversion_factor_to_base_unit, is_base_unit, is_default_sale_unit, is_default_purchase_unit, sort_order, created_at_utc, updated_at_utc)
                SELECT gen_random_uuid(), id, 'Hộp',
                    CASE
                        WHEN unit ~ 'Hộp 3 vỉ x 6 viên' THEN 18
                        WHEN unit ~ 'Hộp 3 vỉ x 10 viên' THEN 30
                        WHEN unit ~ 'Hộp 10 vỉ x 10 viên' THEN 100
                        WHEN unit ~ 'Hộp 50' THEN 50
                        WHEN unit ~ 'Hộp 100' THEN 100
                        ELSE 100
                    END,
                    false, true, true, 3, now(), now()
                FROM products
                WHERE COALESCE(unit, '') ILIKE '%hộp%'
                  AND NOT EXISTS (SELECT 1 FROM product_units WHERE product_units.product_id = products.id AND product_units.unit_name = 'Hộp');
                """);

            migrationBuilder.AddColumn<Guid>(
                name: "product_unit_id",
                table: "product_prices",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "product_unit_id",
                table: "prescription_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "quantity_in_base_units",
                table: "prescription_lines",
                type: "numeric(18,3)",
                precision: 18,
                scale: 3,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<Guid>(
                name: "product_unit_id",
                table: "payment_invoice_lines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "unit_name_snapshot",
                table: "payment_invoice_lines",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE product_prices
                SET product_unit_id = product_units.id
                FROM product_units
                WHERE product_units.product_id = product_prices.product_id
                  AND product_units.is_base_unit = true;
                """);

            migrationBuilder.Sql("""
                UPDATE prescription_lines
                SET product_unit_id = product_units.id,
                    quantity_in_base_units = prescribed_quantity
                FROM product_units
                WHERE product_units.product_id = prescription_lines.product_id
                  AND product_units.is_base_unit = true;
                """);

            migrationBuilder.Sql("""
                UPDATE payment_invoice_lines
                SET product_unit_id = product_units.id,
                    unit_name_snapshot = product_units.unit_name
                FROM product_units
                WHERE product_units.product_id = payment_invoice_lines.product_id
                  AND product_units.is_base_unit = true;
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "product_unit_id",
                table: "product_prices",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "product_unit_id",
                table: "prescription_lines",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.DropColumn(
                name: "unit",
                table: "products");

            migrationBuilder.CreateIndex(
                name: "IX_product_prices_product_id_product_unit_id_site_id_status_ef~",
                table: "product_prices",
                columns: new[] { "product_id", "product_unit_id", "site_id", "status", "effective_from" });

            migrationBuilder.CreateIndex(name: "IX_product_prices_product_unit_id", table: "product_prices", column: "product_unit_id");
            migrationBuilder.CreateIndex(name: "IX_prescription_lines_product_unit_id", table: "prescription_lines", column: "product_unit_id");
            migrationBuilder.CreateIndex(name: "IX_payment_invoice_lines_product_unit_id", table: "payment_invoice_lines", column: "product_unit_id");
            migrationBuilder.CreateIndex(name: "IX_product_units_barcode", table: "product_units", column: "barcode", unique: true, filter: "barcode IS NOT NULL");
            migrationBuilder.CreateIndex(name: "IX_product_units_product_id_unit_name", table: "product_units", columns: new[] { "product_id", "unit_name" }, unique: true);

            migrationBuilder.AddForeignKey(name: "FK_payment_invoice_lines_product_units_product_unit_id", table: "payment_invoice_lines", column: "product_unit_id", principalTable: "product_units", principalColumn: "id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_prescription_lines_product_units_product_unit_id", table: "prescription_lines", column: "product_unit_id", principalTable: "product_units", principalColumn: "id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_product_prices_product_units_product_unit_id", table: "product_prices", column: "product_unit_id", principalTable: "product_units", principalColumn: "id", onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_payment_invoice_lines_product_units_product_unit_id",
                table: "payment_invoice_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_prescription_lines_product_units_product_unit_id",
                table: "prescription_lines");

            migrationBuilder.DropForeignKey(
                name: "FK_product_prices_product_units_product_unit_id",
                table: "product_prices");

            migrationBuilder.DropTable(
                name: "product_units");

            migrationBuilder.DropIndex(
                name: "IX_product_prices_product_id_product_unit_id_site_id_status_ef~",
                table: "product_prices");

            migrationBuilder.DropIndex(
                name: "IX_product_prices_product_unit_id",
                table: "product_prices");

            migrationBuilder.DropIndex(
                name: "IX_prescription_lines_product_unit_id",
                table: "prescription_lines");

            migrationBuilder.DropIndex(
                name: "IX_payment_invoice_lines_product_unit_id",
                table: "payment_invoice_lines");

            migrationBuilder.DropColumn(
                name: "product_unit_id",
                table: "product_prices");

            migrationBuilder.DropColumn(
                name: "product_unit_id",
                table: "prescription_lines");

            migrationBuilder.DropColumn(
                name: "quantity_in_base_units",
                table: "prescription_lines");

            migrationBuilder.DropColumn(
                name: "product_unit_id",
                table: "payment_invoice_lines");

            migrationBuilder.DropColumn(
                name: "unit_name_snapshot",
                table: "payment_invoice_lines");

            migrationBuilder.AddColumn<string>(
                name: "unit",
                table: "products",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_product_prices_product_id_site_id_status_effective_from",
                table: "product_prices",
                columns: new[] { "product_id", "site_id", "status", "effective_from" });
        }
    }
}
