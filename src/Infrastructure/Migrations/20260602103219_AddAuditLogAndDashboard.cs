using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PharmacyCentral.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAuditLogAndDashboard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "audit_log_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    entity_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    site_id = table.Column<Guid>(type: "uuid", nullable: true),
                    summary = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    details = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    occurred_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_log_entries", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_audit_log_entries_action_occurred_at_utc",
                table: "audit_log_entries",
                columns: new[] { "action", "occurred_at_utc" });

            migrationBuilder.CreateIndex(
                name: "IX_audit_log_entries_entity_type_entity_id_occurred_at_utc",
                table: "audit_log_entries",
                columns: new[] { "entity_type", "entity_id", "occurred_at_utc" });

            migrationBuilder.CreateIndex(
                name: "IX_audit_log_entries_occurred_at_utc",
                table: "audit_log_entries",
                column: "occurred_at_utc");

            migrationBuilder.CreateIndex(
                name: "IX_audit_log_entries_site_id_occurred_at_utc",
                table: "audit_log_entries",
                columns: new[] { "site_id", "occurred_at_utc" });

            migrationBuilder.CreateIndex(
                name: "IX_audit_log_entries_user_id_occurred_at_utc",
                table: "audit_log_entries",
                columns: new[] { "user_id", "occurred_at_utc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit_log_entries");
        }
    }
}
