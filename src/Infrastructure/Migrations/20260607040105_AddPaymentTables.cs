using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PharmacyCentral.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPaymentTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "payment_invoices",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    payment_code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    prescription_id = table.Column<Guid>(type: "uuid", nullable: false),
                    site_id = table.Column<Guid>(type: "uuid", nullable: false),
                    total_amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    confirmed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    confirmed_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payment_invoices", x => x.id);
                    table.ForeignKey(
                        name: "FK_payment_invoices_prescriptions_prescription_id",
                        column: x => x.prescription_id,
                        principalTable: "prescriptions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_payment_invoices_sites_site_id",
                        column: x => x.site_id,
                        principalTable: "sites",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "payment_attempts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    payment_invoice_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    method = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    status = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    provider_reference = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    provider_transaction_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    provider_fee = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    instructions_json = table.Column<string>(type: "text", nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payment_attempts", x => x.id);
                    table.ForeignKey(
                        name: "FK_payment_attempts_payment_invoices_payment_invoice_id",
                        column: x => x.payment_invoice_id,
                        principalTable: "payment_invoices",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "payment_invoice_lines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    payment_invoice_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_id = table.Column<Guid>(type: "uuid", nullable: false),
                    prescription_line_id = table.Column<Guid>(type: "uuid", nullable: true),
                    product_batch_id = table.Column<Guid>(type: "uuid", nullable: true),
                    product_name_snapshot = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    batch_number_snapshot = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    display_order = table.Column<int>(type: "integer", nullable: false),
                    unit_price = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    quantity = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    line_total = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payment_invoice_lines", x => x.id);
                    table.ForeignKey(
                        name: "FK_payment_invoice_lines_payment_invoices_payment_invoice_id",
                        column: x => x.payment_invoice_id,
                        principalTable: "payment_invoices",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_payment_invoice_lines_products_product_id",
                        column: x => x.product_id,
                        principalTable: "products",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "payment_transactions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    payment_attempt_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider_transaction_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    provider = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    transfer_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    provider_metadata_json = table.Column<string>(type: "text", nullable: true),
                    raw_provider_response = table.Column<string>(type: "text", nullable: true),
                    occurred_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payment_transactions", x => x.id);
                    table.ForeignKey(
                        name: "FK_payment_transactions_payment_attempts_payment_attempt_id",
                        column: x => x.payment_attempt_id,
                        principalTable: "payment_attempts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_payment_attempts_payment_invoice_id_status",
                table: "payment_attempts",
                columns: new[] { "payment_invoice_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_payment_attempts_provider_transaction_id_provider",
                table: "payment_attempts",
                columns: new[] { "provider_transaction_id", "provider" });

            migrationBuilder.CreateIndex(
                name: "IX_payment_invoice_lines_payment_invoice_id_display_order",
                table: "payment_invoice_lines",
                columns: new[] { "payment_invoice_id", "display_order" });

            migrationBuilder.CreateIndex(
                name: "IX_payment_invoice_lines_product_id",
                table: "payment_invoice_lines",
                column: "product_id");

            migrationBuilder.CreateIndex(
                name: "IX_payment_invoices_payment_code",
                table: "payment_invoices",
                column: "payment_code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_payment_invoices_prescription_id",
                table: "payment_invoices",
                column: "prescription_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_payment_invoices_prescription_id_status",
                table: "payment_invoices",
                columns: new[] { "prescription_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_payment_invoices_site_id_status",
                table: "payment_invoices",
                columns: new[] { "site_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_payment_transactions_payment_attempt_id",
                table: "payment_transactions",
                column: "payment_attempt_id");

            migrationBuilder.CreateIndex(
                name: "IX_payment_transactions_provider_payment_attempt_id",
                table: "payment_transactions",
                columns: new[] { "provider", "payment_attempt_id" });

            migrationBuilder.CreateIndex(
                name: "IX_payment_transactions_provider_provider_transaction_id",
                table: "payment_transactions",
                columns: new[] { "provider", "provider_transaction_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "payment_invoice_lines");

            migrationBuilder.DropTable(
                name: "payment_transactions");

            migrationBuilder.DropTable(
                name: "payment_attempts");

            migrationBuilder.DropTable(
                name: "payment_invoices");
        }
    }
}
