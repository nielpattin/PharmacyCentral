using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.StorageLocations;
using PharmacyCentral.Infrastructure.Persistence;

namespace PharmacyCentral.Infrastructure.Seeding;

internal sealed class DatabaseSeederHostedService(IServiceScopeFactory scopeFactory) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        using IServiceScope scope = scopeFactory.CreateScope();
        PharmacyCentralDbContext dbContext = scope.ServiceProvider.GetRequiredService<PharmacyCentralDbContext>();

        await dbContext.Database.MigrateAsync(cancellationToken);

        await dbContext.Database.ExecuteSqlRawAsync(
            "TRUNCATE TABLE storage_locations, sites RESTART IDENTITY CASCADE;",
            cancellationToken);

        List<Site> sites = CreateSites();
        await dbContext.AddRangeAsync(sites, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

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
}
