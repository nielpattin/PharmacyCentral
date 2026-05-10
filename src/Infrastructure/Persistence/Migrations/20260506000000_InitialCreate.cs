using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using PharmacyCentral.Infrastructure.Persistence;

#nullable disable

namespace PharmacyCentral.Infrastructure.Persistence.Migrations;

[DbContext(typeof(PharmacyCentralDbContext))]
[Migration("20260506000000_InitialCreate")]
public partial class InitialCreate : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "sites",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                site_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                address = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                is_active = table.Column<bool>(type: "boolean", nullable: false),
                created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_sites", x => x.id);
            });

        migrationBuilder.CreateTable(
            name: "storage_locations",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                site_id = table.Column<Guid>(type: "uuid", nullable: false),
                code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                location_type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                capacity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: true),
                is_active = table.Column<bool>(type: "boolean", nullable: false),
                created_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                updated_at_utc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_storage_locations", x => x.id);
                table.ForeignKey(
                    name: "fk_storage_locations_sites_site_id",
                    column: x => x.site_id,
                    principalTable: "sites",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "ix_sites_code",
            table: "sites",
            column: "code",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "ix_storage_locations_site_id_code",
            table: "storage_locations",
            columns: new[] { "site_id", "code" },
            unique: true);

        migrationBuilder.CreateIndex(
            name: "ix_storage_locations_site_id",
            table: "storage_locations",
            column: "site_id");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "storage_locations");

        migrationBuilder.DropTable(
            name: "sites");
    }
}
