using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PharmacyCentral.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRecallWorkflow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "recall_cases",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    recall_number = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    activated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    closed_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    activated_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    closed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recall_cases", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "recall_affected_batches",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    recall_case_id = table.Column<Guid>(type: "uuid", nullable: false),
                    product_batch_id = table.Column<Guid>(type: "uuid", nullable: false),
                    site_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    actioned_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    actioned_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_recall_affected_batches", x => x.id);
                    table.ForeignKey(
                        name: "FK_recall_affected_batches_product_batches_product_batch_id",
                        column: x => x.product_batch_id,
                        principalTable: "product_batches",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_recall_affected_batches_recall_cases_recall_case_id",
                        column: x => x.recall_case_id,
                        principalTable: "recall_cases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_recall_affected_batches_product_batch_id_site_id_status",
                table: "recall_affected_batches",
                columns: new[] { "product_batch_id", "site_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_recall_affected_batches_recall_case_id_product_batch_id_sit~",
                table: "recall_affected_batches",
                columns: new[] { "recall_case_id", "product_batch_id", "site_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_recall_cases_recall_number",
                table: "recall_cases",
                column: "recall_number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_recall_cases_status",
                table: "recall_cases",
                column: "status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "recall_affected_batches");

            migrationBuilder.DropTable(
                name: "recall_cases");
        }
    }
}
