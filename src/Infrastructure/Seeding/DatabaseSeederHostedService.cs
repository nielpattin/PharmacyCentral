using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;

namespace PharmacyCentral.Infrastructure.Seeding;

internal sealed class DatabaseSeederHostedService(IServiceScopeFactory scopeFactory) : IHostedService
{
    private static readonly string[] RoleNames =
    [
        "Platform Admin",
        "Pharmacy Manager",
        "Pharmacist",
        "Warehouse Staff"
    ];

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        using IServiceScope scope = scopeFactory.CreateScope();
        PharmacyCentralDbContext dbContext = scope.ServiceProvider.GetRequiredService<PharmacyCentralDbContext>();
        RoleManager<IdentityRole<Guid>> roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        UserManager<UserAccount> userManager = scope.ServiceProvider.GetRequiredService<UserManager<UserAccount>>();

        await EnsureTablesExistAsync(dbContext, cancellationToken);

        await SeedRolesAsync(roleManager);
        await SeedBusinessDataAsync(dbContext, cancellationToken);
        await SeedAdminUserAsync(userManager, dbContext, cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private static async Task SeedRolesAsync(RoleManager<IdentityRole<Guid>> roleManager)
    {
        foreach (string roleName in RoleNames)
        {
            if (await roleManager.RoleExistsAsync(roleName))
            {
                continue;
            }

            await roleManager.CreateAsync(new IdentityRole<Guid>(roleName));
        }
    }

    private static async Task SeedAdminUserAsync(
        UserManager<UserAccount> userManager,
        PharmacyCentralDbContext dbContext,
        CancellationToken cancellationToken)
    {
        UserAccount? admin = await userManager.FindByEmailAsync("admin@pharmacy.local");
        if (admin is not null)
        {
            return;
        }

        admin = new UserAccount
        {
            Id = Guid.NewGuid(),
            Email = "admin@pharmacy.local",
            UserName = "admin@pharmacy.local",
            DisplayName = "Platform Admin",
            EmailConfirmed = true,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        await userManager.CreateAsync(admin, "Admin@123!");
        await userManager.AddToRoleAsync(admin, "Platform Admin");

        List<Site> sites = await dbContext.Sites.OrderBy(s => s.Code).ToListAsync(cancellationToken);
        foreach (Site site in sites)
        {
            dbContext.UserSiteScopes.Add(new UserSiteScope
            {
                Id = Guid.NewGuid(),
                UserId = admin.Id,
                SiteId = site.Id
            });
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static async Task SeedBusinessDataAsync(PharmacyCentralDbContext dbContext, CancellationToken cancellationToken)
    {
        bool hasSites = await dbContext.Sites.AnyAsync(cancellationToken);
        if (hasSites)
        {
            return;
        }

        List<Site> sites = CreateSites();
        await dbContext.AddRangeAsync(sites, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static List<Site> CreateSites()
    {
        return
        [
            CreateSite("HQ-HCM-01", "Head Office", "Head Office", "Active", "Ho Chi Minh City", "Admin and operations control center",
            [
                CreateLocation("LOC-HQ-01", "Admin Office", "Office"),
                CreateLocation("LOC-HQ-02", "Records Room", "Storage"),
                CreateLocation("LOC-HQ-03", "Operations Desk", "Service")
            ]),

            CreateSite("WH-HCM-01", "Central Warehouse", "Warehouse", "Active", "Ho Chi Minh City", "Primary distribution warehouse",
            [
                CreateLocation("LOC-WH-01", "Receiving Area", "Receiving"),
                CreateLocation("LOC-WH-02", "Bulk Storage", "Storage"),
                CreateLocation("LOC-WH-03", "Dispatch Area", "Dispatch"),
                CreateLocation("LOC-WH-04", "Picking Area", "Picking")
            ]),

            CreateSite("WH-HN-01", "North Warehouse", "Warehouse", "Active", "Hanoi", "Northern distribution warehouse",
            [
                CreateLocation("LOC-NWH-01", "Receiving Area", "Receiving"),
                CreateLocation("LOC-NWH-02", "Bulk Storage", "Storage"),
                CreateLocation("LOC-NWH-03", "Dispatch Area", "Dispatch")
            ]),

            CreateSite("RG-HCM-01", "Saigon Regional Hub", "Regional Hub", "Active", "District 3, Ho Chi Minh City", "Regional support and replenishment point",
            [
                CreateLocation("LOC-RG-01", "Hub Counter", "Service"),
                CreateLocation("LOC-RG-02", "Staging Room", "Storage")
            ]),

            CreateSite("RG-HN-01", "Hanoi Regional Hub", "Regional Hub", "Active", "Cau Giay, Hanoi", "Regional support and replenishment point",
            [
                CreateLocation("LOC-RG-03", "Hub Counter", "Service"),
                CreateLocation("LOC-RG-04", "Staging Room", "Storage")
            ]),

            CreateSite("ST-HCM-01", "District Store 1", "Retail Store", "Active", "District 1, Ho Chi Minh City", "Primary retail outlet",
            [
                CreateLocation("LOC-ST-01", "Front Shelves", "Storage"),
                CreateLocation("LOC-ST-02", "Back Room", "Storage"),
                CreateLocation("LOC-ST-03", "Counter", "Service")
            ]),

            CreateSite("ST-HCM-02", "District Store 2", "Retail Store", "Active", "District 3, Ho Chi Minh City", "Secondary retail outlet",
            [
                CreateLocation("LOC-ST-04", "Front Shelves", "Storage"),
                CreateLocation("LOC-ST-05", "Back Room", "Storage"),
                CreateLocation("LOC-ST-06", "Counter", "Service")
            ]),

            CreateSite("ST-HCM-03", "District Store 3", "Retail Store", "Active", "District 5, Ho Chi Minh City", "Neighborhood retail outlet",
            [
                CreateLocation("LOC-ST-07", "Front Shelves", "Storage"),
                CreateLocation("LOC-ST-08", "Back Room", "Storage")
            ]),

            CreateSite("ST-HCM-04", "District Store 4", "Retail Store", "Inactive", "Phu Nhuan, Ho Chi Minh City", "Temporarily closed for renovation",
            [
                CreateLocation("LOC-ST-09", "Front Shelves", "Storage"),
                CreateLocation("LOC-ST-10", "Back Room", "Storage")
            ]),

            CreateSite("ST-HCM-05", "District Store 5", "Retail Store", "Active", "Binh Thanh, Ho Chi Minh City", "Busy urban outlet",
            [
                CreateLocation("LOC-ST-11", "Front Shelves", "Storage"),
                CreateLocation("LOC-ST-12", "Back Room", "Storage"),
                CreateLocation("LOC-ST-13", "Consultation Desk", "Service")
            ]),

            CreateSite("ST-HCM-06", "District Store 6", "Retail Store", "Active", "Thu Duc, Ho Chi Minh City", "Suburban retail outlet",
            [
                CreateLocation("LOC-ST-14", "Front Shelves", "Storage"),
                CreateLocation("LOC-ST-15", "Back Room", "Storage")
            ]),

            CreateSite("ST-HCM-07", "District Store 7", "Retail Store", "Inactive", "District 10, Ho Chi Minh City", "Awaiting lease renewal",
            [
                CreateLocation("LOC-ST-16", "Front Shelves", "Storage"),
                CreateLocation("LOC-ST-17", "Back Room", "Storage")
            ]),

            CreateSite("ST-HCM-08", "District Store 8", "Retail Store", "Active", "District 7, Ho Chi Minh City", "Family-focused retail outlet",
            [
                CreateLocation("LOC-ST-18", "Front Shelves", "Storage"),
                CreateLocation("LOC-ST-19", "Back Room", "Storage")
            ]),

            CreateSite("ST-HCM-09", "District Store 9", "Retail Store", "Active", "Go Vap, Ho Chi Minh City", "High-volume retail outlet",
            [
                CreateLocation("LOC-ST-20", "Front Shelves", "Storage"),
                CreateLocation("LOC-ST-21", "Back Room", "Storage")
            ]),

            CreateSite("ST-HCM-10", "District Store 10", "Retail Store", "Inactive", "Tan Binh, Ho Chi Minh City", "Closed due to staffing shortage",
            [
                CreateLocation("LOC-ST-22", "Front Shelves", "Storage"),
                CreateLocation("LOC-ST-23", "Back Room", "Storage")
            ]),

            CreateSite("ST-HN-01", "Ba Dinh Store", "Retail Store", "Active", "Ba Dinh, Hanoi", "Central Hanoi retail outlet",
            [
                CreateLocation("LOC-HN-01", "Front Shelves", "Storage"),
                CreateLocation("LOC-HN-02", "Back Room", "Storage")
            ]),

            CreateSite("ST-HN-02", "Cau Giay Store", "Retail Store", "Active", "Cau Giay, Hanoi", "Busy northern retail outlet",
            [
                CreateLocation("LOC-HN-03", "Front Shelves", "Storage"),
                CreateLocation("LOC-HN-04", "Back Room", "Storage"),
                CreateLocation("LOC-HN-05", "Counter", "Service")
            ]),

            CreateSite("ST-HN-03", "Dong Da Store", "Retail Store", "Active", "Dong Da, Hanoi", "Urban retail outlet",
            [
                CreateLocation("LOC-HN-06", "Front Shelves", "Storage"),
                CreateLocation("LOC-HN-07", "Back Room", "Storage")
            ]),

            CreateSite("ST-HN-04", "Hai Ba Trung Store", "Retail Store", "Inactive", "Hai Ba Trung, Hanoi", "Paused while refit is completed",
            [
                CreateLocation("LOC-HN-08", "Front Shelves", "Storage"),
                CreateLocation("LOC-HN-09", "Back Room", "Storage")
            ]),

            CreateSite("ST-HN-05", "Thanh Xuan Store", "Retail Store", "Active", "Thanh Xuan, Hanoi", "Residential district outlet",
            [
                CreateLocation("LOC-HN-10", "Front Shelves", "Storage"),
                CreateLocation("LOC-HN-11", "Back Room", "Storage")
            ]),

            CreateSite("ST-HN-06", "Long Bien Store", "Retail Store", "Active", "Long Bien, Hanoi", "Eastern Hanoi outlet",
            [
                CreateLocation("LOC-HN-12", "Front Shelves", "Storage"),
                CreateLocation("LOC-HN-13", "Back Room", "Storage")
            ]),

            CreateSite("ST-DN-01", "Da Nang Store", "Retail Store", "Inactive", "Da Nang", "Planned branch for rollout",
            [
                CreateLocation("LOC-DN-01", "Front Shelves", "Storage"),
                CreateLocation("LOC-DN-02", "Back Room", "Storage")
            ]),

            CreateSite("ST-DN-02", "Hai Chau Store", "Retail Store", "Active", "Hai Chau, Da Nang", "City center retail outlet",
            [
                CreateLocation("LOC-DN-03", "Front Shelves", "Storage"),
                CreateLocation("LOC-DN-04", "Back Room", "Storage")
            ]),

            CreateSite("ST-DN-03", "Lien Chieu Store", "Retail Store", "Active", "Lien Chieu, Da Nang", "Northern Da Nang outlet",
            [
                CreateLocation("LOC-DN-05", "Front Shelves", "Storage"),
                CreateLocation("LOC-DN-06", "Back Room", "Storage")
            ]),

            CreateSite("ST-DN-04", "Son Tra Store", "Retail Store", "Active", "Son Tra, Da Nang", "Coastal district outlet",
            [
                CreateLocation("LOC-DN-07", "Front Shelves", "Storage"),
                CreateLocation("LOC-DN-08", "Back Room", "Storage")
            ]),

            CreateSite("ST-DN-05", "Ngu Hanh Son Store", "Retail Store", "Inactive", "Ngu Hanh Son, Da Nang", "Seasonal outlet",
            [
                CreateLocation("LOC-DN-09", "Front Shelves", "Storage"),
                CreateLocation("LOC-DN-10", "Back Room", "Storage")
            ]),

            CreateSite("ST-BD-01", "Binh Duong Store", "Retail Store", "Active", "Thu Dau Mot, Binh Duong", "Industrial area outlet",
            [
                CreateLocation("LOC-BD-01", "Front Shelves", "Storage"),
                CreateLocation("LOC-BD-02", "Back Room", "Storage")
            ]),

            CreateSite("ST-BD-02", "Di An Store", "Retail Store", "Active", "Di An, Binh Duong", "Transit area outlet",
            [
                CreateLocation("LOC-BD-03", "Front Shelves", "Storage"),
                CreateLocation("LOC-BD-04", "Back Room", "Storage")
            ]),

            CreateSite("ST-BD-03", "Ben Cat Store", "Retail Store", "Inactive", "Ben Cat, Binh Duong", "Low traffic branch",
            [
                CreateLocation("LOC-BD-05", "Front Shelves", "Storage"),
                CreateLocation("LOC-BD-06", "Back Room", "Storage")
            ]),

            CreateSite("ST-BD-04", "Tan Uyen Store", "Retail Store", "Active", "Tan Uyen, Binh Duong", "Growing suburban outlet",
            [
                CreateLocation("LOC-BD-07", "Front Shelves", "Storage"),
                CreateLocation("LOC-BD-08", "Back Room", "Storage")
            ])
        ];
    }

    private static Site CreateSite(
        string code,
        string name,
        string siteType,
        string status,
        string? address,
        string? notes,
        params StorageLocation[] storageLocations)
    {
        var site = new Site
        {
            Code = code,
            Name = name,
            SiteType = ParseSiteType(siteType),
            Status = status,
            Address = address,
            Notes = notes,
            IsActive = status == "Active"
        };

        foreach (StorageLocation storageLocation in storageLocations)
        {
            storageLocation.Site = site;
            site.StorageLocations.Add(storageLocation);
        }

        return site;
    }

    private static StorageLocation CreateLocation(string code, string name, string locationType) => new()
    {
        Code = code,
        Name = name,
        LocationType = ParseLocationType(locationType),
        Status = "Active",
        IsActive = true
    };

    private static SiteType ParseSiteType(string value)
    {
        return value switch
        {
            "Head Office" or "HeadOffice" => SiteType.HeadOffice,
            "Warehouse" => SiteType.Warehouse,
            "Regional Hub" or "RegionalHub" => SiteType.RegionalHub,
            "Retail Store" or "RetailStore" => SiteType.RetailStore,
            _ => throw new InvalidOperationException($"Unknown site type '{value}'.")
        };
    }

    private static StorageLocationType ParseLocationType(string value)
    {
        return value switch
        {
            "Receiving" => StorageLocationType.Receiving,
            "Storage" => StorageLocationType.Storage,
            "Picking" => StorageLocationType.Picking,
            "Dispatch" => StorageLocationType.Dispatch,
            "Service" => StorageLocationType.Service,
            "Office" => StorageLocationType.Office,
            _ => throw new InvalidOperationException($"Unknown storage location type '{value}'.")
        };
    }

    private static async Task EnsureTablesExistAsync(
        PharmacyCentralDbContext dbContext,
        CancellationToken cancellationToken)
    {
        string sql = """
            CREATE TABLE IF NOT EXISTS "sites" (
                "id" uuid NOT NULL,
                "code" character varying(50) NOT NULL,
                "name" character varying(200) NOT NULL,
                "site_type" character varying(50) NOT NULL,
                "status" character varying(30) NOT NULL,
                "address" character varying(300),
                "notes" character varying(1000),
                "is_active" boolean NOT NULL,
                "created_at_utc" timestamp with time zone NOT NULL DEFAULT now(),
                "updated_at_utc" timestamp with time zone NOT NULL DEFAULT now(),
                CONSTRAINT "pk_sites" PRIMARY KEY ("id")
            );

            CREATE UNIQUE INDEX IF NOT EXISTS "ix_sites_code" ON "sites" ("code");

            CREATE TABLE IF NOT EXISTS "storage_locations" (
                "id" uuid NOT NULL,
                "site_id" uuid NOT NULL,
                "code" character varying(50) NOT NULL,
                "name" character varying(200) NOT NULL,
                "location_type" character varying(50) NOT NULL,
                "status" character varying(30) NOT NULL,
                "capacity" numeric(18,3),
                "is_active" boolean NOT NULL,
                "created_at_utc" timestamp with time zone NOT NULL DEFAULT now(),
                "updated_at_utc" timestamp with time zone NOT NULL DEFAULT now(),
                CONSTRAINT "pk_storage_locations" PRIMARY KEY ("id"),
                CONSTRAINT "fk_storage_locations_sites_site_id" FOREIGN KEY ("site_id") REFERENCES "sites" ("id") ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS "ix_storage_locations_site_id" ON "storage_locations" ("site_id");
            CREATE UNIQUE INDEX IF NOT EXISTS "ix_storage_locations_site_id_code" ON "storage_locations" ("site_id", "code");

            CREATE TABLE IF NOT EXISTS "products" (
                "id" uuid NOT NULL,
                "sku" character varying(50) NOT NULL,
                "name" character varying(200) NOT NULL,
                "category" character varying(100),
                "unit" character varying(50),
                "manufacturer" character varying(200),
                "status" character varying(30) NOT NULL,
                "notes" character varying(1000),
                "is_active" boolean NOT NULL,
                "created_at_utc" timestamp with time zone NOT NULL DEFAULT now(),
                "updated_at_utc" timestamp with time zone NOT NULL DEFAULT now(),
                CONSTRAINT "pk_products" PRIMARY KEY ("id")
            );

            CREATE UNIQUE INDEX IF NOT EXISTS "ix_products_sku" ON "products" ("sku");

            CREATE TABLE IF NOT EXISTS "suppliers" (
                "id" uuid NOT NULL,
                "code" character varying(50) NOT NULL,
                "name" character varying(200) NOT NULL,
                "contact_name" character varying(200),
                "email" character varying(320),
                "phone" character varying(50),
                "address" character varying(300),
                "status" character varying(30) NOT NULL,
                "notes" character varying(1000),
                "is_active" boolean NOT NULL,
                "created_at_utc" timestamp with time zone NOT NULL DEFAULT now(),
                "updated_at_utc" timestamp with time zone NOT NULL DEFAULT now(),
                CONSTRAINT "pk_suppliers" PRIMARY KEY ("id")
            );

            CREATE UNIQUE INDEX IF NOT EXISTS "ix_suppliers_code" ON "suppliers" ("code");

            CREATE TABLE IF NOT EXISTS "AspNetRoles" (
                "Id" uuid NOT NULL,
                "Name" character varying(256),
                "NormalizedName" character varying(256),
                "ConcurrencyStamp" text,
                CONSTRAINT "PK_AspNetRoles" PRIMARY KEY ("Id")
            );

            CREATE UNIQUE INDEX IF NOT EXISTS "RoleNameIndex" ON "AspNetRoles" ("NormalizedName");

            CREATE TABLE IF NOT EXISTS "AspNetUsers" (
                "Id" uuid NOT NULL,
                "DisplayName" character varying(200) NOT NULL DEFAULT '',
                "CreatedAtUtc" timestamp with time zone NOT NULL DEFAULT now(),
                "UpdatedAtUtc" timestamp with time zone NOT NULL DEFAULT now(),
                "UserName" character varying(256),
                "NormalizedUserName" character varying(256),
                "Email" character varying(256),
                "NormalizedEmail" character varying(256),
                "EmailConfirmed" boolean NOT NULL,
                "PasswordHash" text,
                "SecurityStamp" text,
                "ConcurrencyStamp" text,
                "PhoneNumber" text,
                "PhoneNumberConfirmed" boolean NOT NULL,
                "TwoFactorEnabled" boolean NOT NULL,
                "LockoutEnd" timestamp with time zone,
                "LockoutEnabled" boolean NOT NULL,
                "AccessFailedCount" integer NOT NULL,
                CONSTRAINT "PK_AspNetUsers" PRIMARY KEY ("Id")
            );

            CREATE INDEX IF NOT EXISTS "EmailIndex" ON "AspNetUsers" ("NormalizedEmail");
            CREATE UNIQUE INDEX IF NOT EXISTS "UserNameIndex" ON "AspNetUsers" ("NormalizedUserName");

            CREATE TABLE IF NOT EXISTS "AspNetRoleClaims" (
                "Id" integer NOT NULL GENERATED BY DEFAULT AS IDENTITY,
                "RoleId" uuid NOT NULL,
                "ClaimType" text,
                "ClaimValue" text,
                CONSTRAINT "PK_AspNetRoleClaims" PRIMARY KEY ("Id"),
                CONSTRAINT "FK_AspNetRoleClaims_AspNetRoles_RoleId" FOREIGN KEY ("RoleId") REFERENCES "AspNetRoles" ("Id") ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS "IX_AspNetRoleClaims_RoleId" ON "AspNetRoleClaims" ("RoleId");

            CREATE TABLE IF NOT EXISTS "AspNetUserClaims" (
                "Id" integer NOT NULL GENERATED BY DEFAULT AS IDENTITY,
                "UserId" uuid NOT NULL,
                "ClaimType" text,
                "ClaimValue" text,
                CONSTRAINT "PK_AspNetUserClaims" PRIMARY KEY ("Id"),
                CONSTRAINT "FK_AspNetUserClaims_AspNetUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS "IX_AspNetUserClaims_UserId" ON "AspNetUserClaims" ("UserId");

            CREATE TABLE IF NOT EXISTS "AspNetUserLogins" (
                "LoginProvider" text NOT NULL,
                "ProviderKey" text NOT NULL,
                "ProviderDisplayName" text,
                "UserId" uuid NOT NULL,
                CONSTRAINT "PK_AspNetUserLogins" PRIMARY KEY ("LoginProvider", "ProviderKey"),
                CONSTRAINT "FK_AspNetUserLogins_AspNetUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS "IX_AspNetUserLogins_UserId" ON "AspNetUserLogins" ("UserId");

            CREATE TABLE IF NOT EXISTS "AspNetUserRoles" (
                "UserId" uuid NOT NULL,
                "RoleId" uuid NOT NULL,
                CONSTRAINT "PK_AspNetUserRoles" PRIMARY KEY ("UserId", "RoleId"),
                CONSTRAINT "FK_AspNetUserRoles_AspNetRoles_RoleId" FOREIGN KEY ("RoleId") REFERENCES "AspNetRoles" ("Id") ON DELETE CASCADE,
                CONSTRAINT "FK_AspNetUserRoles_AspNetUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS "IX_AspNetUserRoles_RoleId" ON "AspNetUserRoles" ("RoleId");

            CREATE TABLE IF NOT EXISTS "AspNetUserTokens" (
                "UserId" uuid NOT NULL,
                "LoginProvider" text NOT NULL,
                "Name" text NOT NULL,
                "Value" text,
                CONSTRAINT "PK_AspNetUserTokens" PRIMARY KEY ("UserId", "LoginProvider", "Name"),
                CONSTRAINT "FK_AspNetUserTokens_AspNetUsers_UserId" FOREIGN KEY ("UserId") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS "user_site_scopes" (
                "id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "site_id" uuid NOT NULL,
                CONSTRAINT "pk_user_site_scopes" PRIMARY KEY ("id"),
                CONSTRAINT "fk_user_site_scopes_asp_net_users_user_id" FOREIGN KEY ("user_id") REFERENCES "AspNetUsers" ("Id") ON DELETE CASCADE,
                CONSTRAINT "fk_user_site_scopes_sites_site_id" FOREIGN KEY ("site_id") REFERENCES "sites" ("id") ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS "ix_user_site_scopes_site_id" ON "user_site_scopes" ("site_id");
            CREATE UNIQUE INDEX IF NOT EXISTS "ix_user_site_scopes_user_id_site_id" ON "user_site_scopes" ("user_id", "site_id");
            """;

        await dbContext.Database.ExecuteSqlRawAsync(sql, cancellationToken);
    }
}
