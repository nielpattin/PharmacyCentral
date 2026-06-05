using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PharmacyCentral.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddProductBatchQualityStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "quality_notes",
                table: "product_batches",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "quality_reviewed_at_utc",
                table: "product_batches",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "quality_reviewed_by_user_id",
                table: "product_batches",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "quality_status",
                table: "product_batches",
                type: "character varying(30)",
                maxLength: 30,
                nullable: false,
                defaultValue: "Released");

            migrationBuilder.CreateIndex(
                name: "IX_product_batches_quality_status",
                table: "product_batches",
                column: "quality_status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_product_batches_quality_status",
                table: "product_batches");

            migrationBuilder.DropColumn(
                name: "quality_notes",
                table: "product_batches");

            migrationBuilder.DropColumn(
                name: "quality_reviewed_at_utc",
                table: "product_batches");

            migrationBuilder.DropColumn(
                name: "quality_reviewed_by_user_id",
                table: "product_batches");

            migrationBuilder.DropColumn(
                name: "quality_status",
                table: "product_batches");
        }
    }
}
