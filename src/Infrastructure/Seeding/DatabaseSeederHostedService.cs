using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PharmacyCentral.Domain.GoodsReceipts;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Prescriptions;
using PharmacyCentral.Domain.Pricing;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Sites;
using PharmacyCentral.Domain.Stocktakes;
using PharmacyCentral.Domain.StorageLocations;
using PharmacyCentral.Domain.Suppliers;
using PharmacyCentral.Domain.Transfers;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Persistence;

namespace PharmacyCentral.Infrastructure.Seeding;

internal sealed class DatabaseSeederHostedService(IServiceScopeFactory scopeFactory, IConfiguration configuration) : IHostedService
{
    private static readonly string[] RoleNames =
    [
        "Platform Admin",
        "Pharmacy Manager",
        "Pharmacist",
        "Warehouse Staff"
    ];

    private const string SeedingSectionName = "PharmacyCentral:Seeding";

    private sealed record UserSeed(
        string Email,
        string Password,
        string DisplayName,
        string RoleName,
        bool AllSites,
        string[] SiteCodes);

    private static readonly UserSeed AdminUserSeed = new(
        "admin@pharmacy.local",
        "Admin@123!",
        "Quản trị viên",
        "Platform Admin",
        true,
        []);

    private static readonly UserSeed[] DemoUserSeeds =
    [
        new(
            "manager@pharmacy.local",
            "Manager@123!",
            "Quản lý nhà thuốc",
            "Pharmacy Manager",
            false,
            ["HQ-HCM-01", "WH-HCM-01", "RG-HCM-01", "ST-HCM-01"]),
        new(
            "pharmacist@pharmacy.local",
            "Pharmacist@123!",
            "Dược sĩ bán hàng",
            "Pharmacist",
            false,
            ["ST-HCM-01"]),
        new(
            "warehouse@pharmacy.local",
            "Warehouse@123!",
            "Nhân viên kho",
            "Warehouse Staff",
            false,
            ["WH-HCM-01", "ST-HCM-01"])
    ];

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        using IServiceScope scope = scopeFactory.CreateScope();
        PharmacyCentralDbContext dbContext = scope.ServiceProvider.GetRequiredService<PharmacyCentralDbContext>();
        RoleManager<IdentityRole<Guid>> roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        UserManager<UserAccount> userManager = scope.ServiceProvider.GetRequiredService<UserManager<UserAccount>>();

        await SeedRolesAsync(roleManager);

        if (IsEnabled("SeedBusinessData", defaultValue: true))
        {
            await SeedBusinessDataAsync(dbContext, cancellationToken);
        }

        List<UserSeed> usersToSeed = [];
        if (IsEnabled("SeedAdminUser", defaultValue: true))
        {
            usersToSeed.Add(AdminUserSeed);
        }

        if (IsEnabled("SeedDemoUsers", defaultValue: true))
        {
            usersToSeed.AddRange(DemoUserSeeds);
        }

        await SeedUsersAsync(userManager, dbContext, usersToSeed, cancellationToken);
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

    private bool IsEnabled(string key, bool defaultValue)
    {
        return configuration.GetValue<bool?>($"{SeedingSectionName}:{key}") ?? defaultValue;
    }

    private static async Task SeedUsersAsync(
        UserManager<UserAccount> userManager,
        PharmacyCentralDbContext dbContext,
        IReadOnlyCollection<UserSeed> userSeeds,
        CancellationToken cancellationToken)
    {
        List<Site> sites = await dbContext.Sites.OrderBy(s => s.Code).ToListAsync(cancellationToken);

        foreach (UserSeed seed in userSeeds)
        {
            UserAccount? user = await userManager.FindByEmailAsync(seed.Email);
            if (user is null)
            {
                user = new UserAccount
                {
                    Id = Guid.NewGuid(),
                    Email = seed.Email,
                    UserName = seed.Email,
                    DisplayName = seed.DisplayName,
                    EmailConfirmed = true,
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                    UpdatedAtUtc = DateTimeOffset.UtcNow
                };

                IdentityResult createResult = await userManager.CreateAsync(user, seed.Password);
                if (!createResult.Succeeded)
                {
                    string error = createResult.Errors.FirstOrDefault()?.Description ?? "User creation failed.";
                    throw new InvalidOperationException($"Failed to seed user '{seed.Email}': {error}");
                }
            }

            if (!await userManager.IsInRoleAsync(user, seed.RoleName))
            {
                IdentityResult roleResult = await userManager.AddToRoleAsync(user, seed.RoleName);
                if (!roleResult.Succeeded)
                {
                    string error = roleResult.Errors.FirstOrDefault()?.Description ?? "Role assignment failed.";
                    throw new InvalidOperationException($"Failed to assign role '{seed.RoleName}' to '{seed.Email}': {error}");
                }
            }

            HashSet<Guid> existingSiteIds = await dbContext.UserSiteScopes
                .Where(scope => scope.UserId == user.Id)
                .Select(scope => scope.SiteId)
                .ToHashSetAsync(cancellationToken);

            IEnumerable<Site> assignedSites = seed.AllSites
                ? sites
                : sites.Where(site => seed.SiteCodes.Contains(site.Code));

            foreach (Site site in assignedSites)
            {
                if (existingSiteIds.Contains(site.Id))
                {
                    continue;
                }

                dbContext.UserSiteScopes.Add(new UserSiteScope
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Id,
                    SiteId = site.Id
                });
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static async Task SeedBusinessDataAsync(PharmacyCentralDbContext dbContext, CancellationToken cancellationToken)
    {
        bool hasProducts = await dbContext.Products.AnyAsync(cancellationToken);
        if (hasProducts)
        {
            return;
        }

        List<Site> sites = await dbContext.Sites.Include(s => s.StorageLocations).ToListAsync(cancellationToken);
        if (sites.Count is 0)
        {
            sites = CreateSites();
            await dbContext.AddRangeAsync(sites, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        List<Product> products = CreateProducts();
        await dbContext.AddRangeAsync(products, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        List<ProductPrice> prices = CreateProductPrices(products);
        await dbContext.AddRangeAsync(prices, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    // ── Sites & Locations ──────────────────────────────────────────────

    private static List<Site> CreateSites()
    {
        return
        [
            CreateSite("HQ-HCM-01", "Trụ sở chính", "Head Office", "Active", "TP. Hồ Chí Minh", "Điểm quản trị hệ thống",
            [
                CreateLocation("LOC-HQ-01", "Văn phòng quản trị", "Office")
            ]),

            CreateSite("WH-HCM-01", "Kho trung tâm", "Warehouse", "Active", "TP. Hồ Chí Minh", "Kho lưu trữ và điều phối hàng hóa",
            [
                CreateLocation("LOC-WH-01", "Kho lưu trữ", "Storage")
            ]),

            CreateSite("RG-HCM-01", "Trung tâm khu vực", "Regional Hub", "Active", "TP. Hồ Chí Minh", "Điểm hỗ trợ vận hành khu vực",
            [
                CreateLocation("LOC-RG-01", "Khu tập kết", "Storage")
            ]),

            CreateSite("ST-HCM-01", "Nhà thuốc trung tâm", "Retail Store", "Active", "TP. Hồ Chí Minh", "Cơ sở bán lẻ demo",
            [
                CreateLocation("LOC-ST-01", "Quầy bán hàng", "Service")
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
        Site site = new()
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

    // ── Products ───────────────────────────────────────────────────────

    private static List<Product> CreateProducts()
    {
        return
        [
            CreateProduct("PARA-500", "Paracetamol 500mg", "Giảm đau hạ sốt", "Công ty CP Dược Hậu Giang", 10, 100),
            CreateProduct("AMOX-500", "Amoxicillin 500mg", "Kháng sinh", "Công ty CP Dược phẩm Traphaco", 10, 100),
            CreateProduct("OMEP-20", "Omeprazol 20mg", "Dạ dày", "Công ty CP Dược phẩm Domesco", 10, 30),
            CreateProduct("CETI-10", "Cetirizin 10mg", "Kháng dị ứng", "Công ty CP Dược Hậu Giang", 10, 100),
            CreateProduct("METF-500", "Metformin 500mg", "Tiểu đường", "Công ty CP Dược phẩm Traphaco", 10, 100),
            CreateProduct("AMLO-5", "Amlodipine 5mg", "Tăng huyết áp", "Công ty CP Dược phẩm Domesco", 10, 100),
            CreateProduct("VITC-100", "Vitamin C 100mg", "Vitamin", "Công ty CP Dược Hậu Giang", 10, 100),
            CreateProduct("IBUP-400", "Ibuprofen 400mg", "Giảm đau kháng viêm", "Công ty CP Dược phẩm Traphaco", 10, 100),
            CreateProduct("LORA-10", "Loratadin 10mg", "Kháng dị ứng", "Công ty CP Dược phẩm Domesco", 10, 100),
            CreateProduct("PANT-40", "Pantoprazole 40mg", "Dạ dày", "Công ty CP Dược Hậu Giang", 10, 30),
            CreateProduct("CEFZ-500", "Cefuroxim 500mg", "Kháng sinh", "Công ty CP Dược phẩm Traphaco", 10, 100),
            CreateProduct("DICL-50", "Diclofenac 50mg", "Giảm đau kháng viêm", "Công ty CP Dược phẩm Domesco", 10, 100),
            CreateProduct("CLOP-75", "Clopidogrel 75mg", "Tim mạch", "Công ty CP Dược Hậu Giang", 10, 30),
            CreateProduct("RANI-150", "Ranitidin 150mg", "Dạ dày", "Công ty CP Dược phẩm Traphaco", 10, 100),
            CreateProduct("AZIT-500", "Azithromycin 500mg", "Kháng sinh", "Công ty CP Dược phẩm Domesco", 6, 18),
            CreateProduct("GLUC-500", "Glucose 50%", "Dịch truyền", "Công ty CP Dược Hậu Giang", "Ống", 50),
            CreateProduct("BAND-AID", "Băng dán cá nhân", "Vật tư y tế", "Công ty CP Thiết bị y tế Việt Nhật", "Miếng", 100),
            CreateProduct("THERMO", "Nhiệt kế điện tử", "Thiết bị y tế", "Công ty CP Thiết bị y tế Việt Nhật", "Cái", null),
            CreateProduct("FACE-MASK", "Khẩu trang y tế 4 lớp", "Vật tư y tế", "Công ty TNHH Bảo hộ lao động Phú An", "Cái", 50),
            CreateProduct("HAND-SAN", "Nước rửa tay khô 500ml", "Vệ sinh", "Công ty TNHH Hóa phẩm Á Đông", "Chai", null)
        ];
    }

    private static Product CreateProduct(string sku, string name, string category, string manufacturer, int stripFactor, int boxFactor)
    {
        Product product = CreateProduct(sku, name, category, manufacturer, "Viên", boxFactor);
        product.Units.Insert(1, CreateUnit("Vỉ", stripFactor, false, true, false, 2));
        product.Units[2].SortOrder = 3;
        return product;
    }

    private static Product CreateProduct(string sku, string name, string category, string manufacturer, string baseUnitName, int? boxFactor)
    {
        Product product = new()
        {
            Sku = sku,
            Name = name,
            Category = category,
            Manufacturer = manufacturer,
            Status = "Active",
            IsActive = true
        };

        product.Units.Add(CreateUnit(baseUnitName, 1m, true, true, boxFactor is null, 1));
        if (boxFactor is not null)
        {
            product.Units.Add(CreateUnit("Hộp", boxFactor.Value, false, true, true, 2));
        }

        return product;
    }

    private static ProductUnit CreateUnit(string unitName, decimal conversionFactorToBaseUnit, bool isBaseUnit, bool isDefaultSaleUnit, bool isDefaultPurchaseUnit, int sortOrder) => new()
    {
        UnitName = unitName,
        ConversionFactorToBaseUnit = conversionFactorToBaseUnit,
        IsBaseUnit = isBaseUnit,
        IsDefaultSaleUnit = isDefaultSaleUnit,
        IsDefaultPurchaseUnit = isDefaultPurchaseUnit,
        SortOrder = sortOrder
    };

    private static List<ProductPrice> CreateProductPrices(List<Product> products)
    {
        List<ProductPrice> prices = [];
        DateOnly effectiveFrom = new(2025, 1, 1);

        foreach (Product product in products)
        {
            decimal basePrice = GetBaseUnitPrice(product.Sku);
            foreach (ProductUnit unit in product.Units)
            {
                decimal unitPrice = unit.IsBaseUnit
                    ? basePrice
                    : Math.Round(basePrice * unit.ConversionFactorToBaseUnit * (unit.UnitName == "Hộp" ? 0.9m : 0.95m), 0);

                prices.Add(new ProductPrice
                {
                    Product = product,
                    ProductUnit = unit,
                    UnitPrice = unitPrice,
                    Currency = "VND",
                    EffectiveFrom = effectiveFrom,
                    Status = ProductPriceStatus.Published,
                    PublishedAtUtc = DateTimeOffset.UtcNow,
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                    UpdatedAtUtc = DateTimeOffset.UtcNow
                });
            }
        }

        return prices;
    }

    private static decimal GetBaseUnitPrice(string sku) => sku switch
    {
        "PARA-500" => 1_500m,
        "AMOX-500" => 2_500m,
        "OMEP-20" => 2_000m,
        "CETI-10" => 1_200m,
        "METF-500" => 1_800m,
        "AMLO-5" => 1_600m,
        "VITC-100" => 800m,
        "IBUP-400" => 1_700m,
        "LORA-10" => 1_300m,
        "PANT-40" => 2_200m,
        "CEFZ-500" => 3_500m,
        "DICL-50" => 1_400m,
        "CLOP-75" => 4_000m,
        "RANI-150" => 1_500m,
        "AZIT-500" => 7_000m,
        "GLUC-500" => 5_000m,
        "BAND-AID" => 500m,
        "THERMO" => 75_000m,
        "FACE-MASK" => 1_000m,
        "HAND-SAN" => 55_000m,
        _ => 1_000m
    };

    // ── Suppliers ──────────────────────────────────────────────────────

    private static List<Supplier> CreateSuppliers()
    {
        return
        [
            CreateSupplier("SUP-DHG", "Công ty CP Dược Hậu Giang", "Nguyễn Thị Mai", "mai.nguyen@dhg.com.vn", "02923891344", "30 Nguyễn Văn Cừ, TP. Cần Thơ"),
            CreateSupplier("SUP-TRC", "Công ty CP Dược phẩm Traphaco", "Trần Văn Hùng", "hung.tran@traphaco.com.vn", "02438256557", "75 Phố Giảng Võ, Hà Nội"),
            CreateSupplier("SUP-DMC", "Công ty CP Dược phẩm Domesco", "Lê Thị Lan", "lan.le@domeco.com.vn", "02713852795", "144 Đại lộ Lê Lợi, TP. Cao Lãnh"),
            CreateSupplier("SUP-VNJ", "Công ty CP Thiết bị y tế Việt Nhật", "Phạm Minh Tuấn", "tuan.pham@vnjmed.com.vn", "02836207548", "88 Đường số 9, Quận 9, TP. Hồ Chí Minh"),
            CreateSupplier("SUP-ADO", "Công ty TNHH Hóa phẩm Á Đông", "Vũ Thanh Hương", "huong.vu@adong.com.vn", "02437952163", "22 Phố Trung Kính, Cầu Giấy, Hà Nội")
        ];
    }

    private static Supplier CreateSupplier(string code, string name, string contactName, string email, string phone, string address) => new()
    {
        Code = code,
        Name = name,
        ContactName = contactName,
        Email = email,
        Phone = phone,
        Address = address,
        Status = "Active",
        IsActive = true
    };

    // ── Product Batches ────────────────────────────────────────────────

    private static List<ProductBatch> CreateProductBatches(List<Product> products, List<Supplier> suppliers)
    {
        Dictionary<string, Product> productMap = products.ToDictionary(p => p.Sku);
        Dictionary<string, Supplier> supplierMap = suppliers.ToDictionary(s => s.Code);

        return
        [
            CreateBatch(productMap["PARA-500"], "PARA-2024-001", new DateOnly(2026, 8, 15), new DateOnly(2024, 8, 15), "DHG Pharma", supplierMap["SUP-DHG"]),
            CreateBatch(productMap["PARA-500"], "PARA-2025-002", new DateOnly(2027, 3, 20), new DateOnly(2025, 3, 20), "DHG Pharma", supplierMap["SUP-DHG"]),
            CreateBatch(productMap["AMOX-500"], "AMOX-2024-001", new DateOnly(2026, 11, 30), new DateOnly(2024, 11, 30), "Traphaco", supplierMap["SUP-TRC"]),
            CreateBatch(productMap["AMOX-500"], "AMOX-2025-002", new DateOnly(2027, 5, 10), new DateOnly(2025, 5, 10), "Traphaco", supplierMap["SUP-TRC"]),
            CreateBatch(productMap["OMEP-20"], "OMEP-2024-001", new DateOnly(2026, 6, 30), new DateOnly(2024, 6, 30), "Domesco", supplierMap["SUP-DMC"]),
            CreateBatch(productMap["OMEP-20"], "OMEP-2025-002", new DateOnly(2027, 1, 15), new DateOnly(2025, 1, 15), "Domesco", supplierMap["SUP-DMC"]),
            CreateBatch(productMap["CETI-10"], "CETI-2025-001", new DateOnly(2027, 4, 20), new DateOnly(2025, 4, 20), "DHG Pharma", supplierMap["SUP-DHG"]),
            CreateBatch(productMap["METF-500"], "METF-2024-001", new DateOnly(2026, 12, 31), new DateOnly(2024, 12, 31), "Traphaco", supplierMap["SUP-TRC"]),
            CreateBatch(productMap["METF-500"], "METF-2025-002", new DateOnly(2027, 6, 15), new DateOnly(2025, 6, 15), "Traphaco", supplierMap["SUP-TRC"]),
            CreateBatch(productMap["AMLO-5"], "AMLO-2025-001", new DateOnly(2027, 7, 10), new DateOnly(2025, 7, 10), "Domesco", supplierMap["SUP-DMC"]),
            CreateBatch(productMap["VITC-100"], "VITC-2025-001", new DateOnly(2027, 12, 31), new DateOnly(2025, 12, 31), "DHG Pharma", supplierMap["SUP-DHG"]),
            CreateBatch(productMap["IBUP-400"], "IBUP-2025-001", new DateOnly(2027, 3, 25), new DateOnly(2025, 3, 25), "Traphaco", supplierMap["SUP-TRC"]),
            CreateBatch(productMap["LORA-10"], "LORA-2025-001", new DateOnly(2027, 8, 5), new DateOnly(2025, 8, 5), "Domesco", supplierMap["SUP-DMC"]),
            CreateBatch(productMap["PANT-40"], "PANT-2025-001", new DateOnly(2027, 2, 28), new DateOnly(2025, 2, 28), "DHG Pharma", supplierMap["SUP-DHG"]),
            CreateBatch(productMap["CEFZ-500"], "CEFZ-2025-001", new DateOnly(2027, 9, 14), new DateOnly(2025, 9, 14), "Traphaco", supplierMap["SUP-TRC"]),
            CreateBatch(productMap["DICL-50"], "DICL-2025-001", new DateOnly(2027, 4, 30), new DateOnly(2025, 4, 30), "Domesco", supplierMap["SUP-DMC"]),
            CreateBatch(productMap["CLOP-75"], "CLOP-2025-001", new DateOnly(2027, 10, 20), new DateOnly(2025, 10, 20), "DHG Pharma", supplierMap["SUP-DHG"]),
            CreateBatch(productMap["RANI-150"], "RANI-2024-001", new DateOnly(2026, 5, 15), new DateOnly(2024, 5, 15), "Traphaco", supplierMap["SUP-TRC"]),
            CreateBatch(productMap["AZIT-500"], "AZIT-2025-001", new DateOnly(2027, 6, 30), new DateOnly(2025, 6, 30), "Domesco", supplierMap["SUP-DMC"]),
            CreateBatch(productMap["GLUC-500"], "GLUC-2025-001", new DateOnly(2027, 11, 1), new DateOnly(2025, 11, 1), "DHG Pharma", supplierMap["SUP-DHG"]),
            CreateBatch(productMap["BAND-AID"], "BAND-2025-001", new DateOnly(2028, 3, 15), new DateOnly(2025, 3, 15), "VNJ Medical", supplierMap["SUP-VNJ"]),
            CreateBatch(productMap["THERMO"], "THER-2025-001", new DateOnly(2028, 6, 1), new DateOnly(2025, 6, 1), "VNJ Medical", supplierMap["SUP-VNJ"]),
            CreateBatch(productMap["FACE-MASK"], "MASK-2025-001", new DateOnly(2027, 9, 30), new DateOnly(2025, 9, 30), "Phu An Safety", supplierMap["SUP-VNJ"]),
            CreateBatch(productMap["HAND-SAN"], "HSAN-2025-001", new DateOnly(2027, 5, 20), new DateOnly(2025, 5, 20), "AD Chemical", supplierMap["SUP-ADO"])
        ];
    }

    private static ProductBatch CreateBatch(Product product, string batchNumber, DateOnly expiryDate, DateOnly manufacturedDate, string manufacturer, Supplier? supplier = null) => new()
    {
        Product = product,
        BatchNumber = batchNumber,
        ExpiryDate = expiryDate,
        ManufacturedDate = manufacturedDate,
        Manufacturer = manufacturer,
        Supplier = supplier,
        Status = "Active"
    };

    // ── Inventory Balances ─────────────────────────────────────────────

    private static List<InventoryBalance> CreateInventoryBalances(
        Dictionary<string, ProductBatch> batchMap,
        Dictionary<string, Site> siteMap,
        Dictionary<string, StorageLocation> locationMap)
    {
        return
        [
            // Kho trung tâm HCM - bulk storage
            CreateBalance(batchMap["PARA-2025-002"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 5000m, 0m),
            CreateBalance(batchMap["AMOX-2025-002"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 3000m, 0m),
            CreateBalance(batchMap["OMEP-2025-002"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 2000m, 0m),
            CreateBalance(batchMap["CETI-2025-001"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 4000m, 0m),
            CreateBalance(batchMap["METF-2025-002"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 1500m, 0m),
            CreateBalance(batchMap["AMLO-2025-001"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 1500m, 0m),
            CreateBalance(batchMap["VITC-2025-001"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 6000m, 0m),
            CreateBalance(batchMap["IBUP-2025-001"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 2500m, 0m),
            CreateBalance(batchMap["LORA-2025-001"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 3000m, 0m),
            CreateBalance(batchMap["MASK-2025-001"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 200m, 0m),
            CreateBalance(batchMap["HSAN-2025-001"], siteMap["WH-HCM-01"], locationMap["LOC-WH-02"], 150m, 0m),

            // Kho miền Bắc - bulk storage
            CreateBalance(batchMap["PARA-2024-001"], siteMap["WH-HN-01"], locationMap["LOC-NWH-02"], 2000m, 0m),
            CreateBalance(batchMap["AMOX-2024-001"], siteMap["WH-HN-01"], locationMap["LOC-NWH-02"], 1500m, 0m),
            CreateBalance(batchMap["OMEP-2024-001"], siteMap["WH-HN-01"], locationMap["LOC-NWH-02"], 800m, 0m),
            CreateBalance(batchMap["METF-2024-001"], siteMap["WH-HN-01"], locationMap["LOC-NWH-02"], 600m, 0m),
            CreateBalance(batchMap["CEFZ-2025-001"], siteMap["WH-HN-01"], locationMap["LOC-NWH-02"], 1000m, 0m),
            CreateBalance(batchMap["DICL-2025-001"], siteMap["WH-HN-01"], locationMap["LOC-NWH-02"], 1200m, 0m),
            CreateBalance(batchMap["AZIT-2025-001"], siteMap["WH-HN-01"], locationMap["LOC-NWH-02"], 900m, 0m),

            // Nhà thuốc Quận 1 - front shelves
            CreateBalance(batchMap["PARA-2025-002"], siteMap["ST-HCM-01"], locationMap["LOC-ST-01"], 200m, 10m),
            CreateBalance(batchMap["AMOX-2025-002"], siteMap["ST-HCM-01"], locationMap["LOC-ST-01"], 150m, 5m),
            CreateBalance(batchMap["OMEP-2025-002"], siteMap["ST-HCM-01"], locationMap["LOC-ST-01"], 100m, 0m),
            CreateBalance(batchMap["CETI-2025-001"], siteMap["ST-HCM-01"], locationMap["LOC-ST-01"], 180m, 0m),
            CreateBalance(batchMap["VITC-2025-001"], siteMap["ST-HCM-01"], locationMap["LOC-ST-01"], 300m, 0m),
            CreateBalance(batchMap["MASK-2025-001"], siteMap["ST-HCM-01"], locationMap["LOC-ST-01"], 20m, 0m),

            // Nhà thuốc Quận 1 - kho trong
            CreateBalance(batchMap["PARA-2025-002"], siteMap["ST-HCM-01"], locationMap["LOC-ST-02"], 500m, 0m),
            CreateBalance(batchMap["AMOX-2025-002"], siteMap["ST-HCM-01"], locationMap["LOC-ST-02"], 300m, 0m),

            // Nhà thuốc Cầu Giấy - kệ trưng bày
            CreateBalance(batchMap["PARA-2024-001"], siteMap["ST-HN-02"], locationMap["LOC-HN-03"], 180m, 5m),
            CreateBalance(batchMap["AMOX-2024-001"], siteMap["ST-HN-02"], locationMap["LOC-HN-03"], 120m, 0m),
            CreateBalance(batchMap["OMEP-2024-001"], siteMap["ST-HN-02"], locationMap["LOC-HN-03"], 80m, 0m),
            CreateBalance(batchMap["CEFZ-2025-001"], siteMap["ST-HN-02"], locationMap["LOC-HN-03"], 100m, 0m),
            CreateBalance(batchMap["MASK-2025-001"], siteMap["ST-HN-02"], locationMap["LOC-HN-03"], 15m, 0m),

            // Nhà thuốc Hải Châu - kệ trưng bày
            CreateBalance(batchMap["PARA-2025-002"], siteMap["ST-DN-02"], locationMap["LOC-DN-03"], 150m, 0m),
            CreateBalance(batchMap["AMOX-2025-002"], siteMap["ST-DN-02"], locationMap["LOC-DN-03"], 100m, 0m),
            CreateBalance(batchMap["VITC-2025-001"], siteMap["ST-DN-02"], locationMap["LOC-DN-03"], 200m, 0m),
            CreateBalance(batchMap["HSAN-2025-001"], siteMap["ST-DN-02"], locationMap["LOC-DN-03"], 30m, 0m),

            // Nhà thuốc Bình Dương - kệ trưng bày
            CreateBalance(batchMap["PARA-2025-002"], siteMap["ST-BD-01"], locationMap["LOC-BD-01"], 120m, 0m),
            CreateBalance(batchMap["METF-2025-002"], siteMap["ST-BD-01"], locationMap["LOC-BD-01"], 60m, 0m),
            CreateBalance(batchMap["AMLO-2025-001"], siteMap["ST-BD-01"], locationMap["LOC-BD-01"], 80m, 0m),
            CreateBalance(batchMap["CLOP-2025-001"], siteMap["ST-BD-01"], locationMap["LOC-BD-01"], 50m, 0m)
        ];
    }

    private static InventoryBalance CreateBalance(ProductBatch batch, Site site, StorageLocation location, decimal quantityOnHand, decimal quantityReserved) => new()
    {
        ProductBatch = batch,
        Site = site,
        StorageLocation = location,
        QuantityOnHand = quantityOnHand,
        QuantityReserved = quantityReserved
    };

    // ── Goods Receipts ─────────────────────────────────────────────────

    private static List<GoodsReceipt> CreateGoodsReceipts(
        List<Supplier> suppliers,
        List<Product> products,
        List<ProductBatch> batches,
        Dictionary<string, Site> siteMap,
        Dictionary<string, StorageLocation> locationMap)
    {
        Dictionary<string, Supplier> supplierMap = suppliers.ToDictionary(s => s.Code);
        Dictionary<string, ProductBatch> batchMap = batches.ToDictionary(b => b.BatchNumber);

        GoodsReceipt gr1 = CreateGoodsReceipt("GR-2025-0001", supplierMap["SUP-DHG"], siteMap["WH-HCM-01"], locationMap["LOC-WH-01"],
            new DateTimeOffset(2025, 1, 15, 9, 0, 0, TimeSpan.Zero), "Nhập hàng định kỳ tháng 1",
            [
                CreateGoodsReceiptLine(batchMap["PARA-2025-002"].Product, batchMap["PARA-2025-002"], "PARA-2025-002", new DateOnly(2027, 3, 20), 2000m),
                CreateGoodsReceiptLine(batchMap["VITC-2025-001"].Product, batchMap["VITC-2025-001"], "VITC-2025-001", new DateOnly(2027, 12, 31), 3000m),
                CreateGoodsReceiptLine(batchMap["CLOP-2025-001"].Product, batchMap["CLOP-2025-001"], "CLOP-2025-001", new DateOnly(2027, 10, 20), 500m)
            ]);

        GoodsReceipt gr2 = CreateGoodsReceipt("GR-2025-0002", supplierMap["SUP-TRC"], siteMap["WH-HCM-01"], locationMap["LOC-WH-01"],
            new DateTimeOffset(2025, 2, 10, 8, 30, 0, TimeSpan.Zero), "Nhập kháng sinh và giảm đau",
            [
                CreateGoodsReceiptLine(batchMap["AMOX-2025-002"].Product, batchMap["AMOX-2025-002"], "AMOX-2025-002", new DateOnly(2027, 5, 10), 1500m),
                CreateGoodsReceiptLine(batchMap["IBUP-2025-001"].Product, batchMap["IBUP-2025-001"], "IBUP-2025-001", new DateOnly(2027, 3, 25), 1000m),
                CreateGoodsReceiptLine(batchMap["CEFZ-2025-001"].Product, batchMap["CEFZ-2025-001"], "CEFZ-2025-001", new DateOnly(2027, 9, 14), 800m)
            ]);

        GoodsReceipt gr3 = CreateGoodsReceipt("GR-2025-0003", supplierMap["SUP-DMC"], siteMap["WH-HCM-01"], locationMap["LOC-WH-01"],
            new DateTimeOffset(2025, 3, 5, 10, 0, 0, TimeSpan.Zero), "Nhập thuốc dạ dày và tim mạch",
            [
                CreateGoodsReceiptLine(batchMap["OMEP-2025-002"].Product, batchMap["OMEP-2025-002"], "OMEP-2025-002", new DateOnly(2027, 1, 15), 1200m),
                CreateGoodsReceiptLine(batchMap["PANT-2025-001"].Product, batchMap["PANT-2025-001"], "PANT-2025-001", new DateOnly(2027, 2, 28), 800m),
                CreateGoodsReceiptLine(batchMap["AMLO-2025-001"].Product, batchMap["AMLO-2025-001"], "AMLO-2025-001", new DateOnly(2027, 7, 10), 600m)
            ]);

        GoodsReceipt gr4 = CreateGoodsReceipt("GR-2025-0004", supplierMap["SUP-TRC"], siteMap["WH-HN-01"], locationMap["LOC-NWH-01"],
            new DateTimeOffset(2025, 2, 20, 14, 0, 0, TimeSpan.Zero), "Nhập hàng kho miền Bắc",
            [
                CreateGoodsReceiptLine(batchMap["PARA-2024-001"].Product, batchMap["PARA-2024-001"], "PARA-2024-001", new DateOnly(2026, 8, 15), 1000m),
                CreateGoodsReceiptLine(batchMap["AMOX-2024-001"].Product, batchMap["AMOX-2024-001"], "AMOX-2024-001", new DateOnly(2026, 11, 30), 800m),
                CreateGoodsReceiptLine(batchMap["RANI-2024-001"].Product, batchMap["RANI-2024-001"], "RANI-2024-001", new DateOnly(2026, 5, 15), 600m)
            ]);

        GoodsReceipt gr5 = CreateGoodsReceipt("GR-2025-0005", supplierMap["SUP-VNJ"], siteMap["WH-HCM-01"], locationMap["LOC-WH-01"],
            new DateTimeOffset(2025, 4, 1, 9, 30, 0, TimeSpan.Zero), "Nhập vật tư y tế",
            [
                CreateGoodsReceiptLine(batchMap["BAND-2025-001"].Product, batchMap["BAND-2025-001"], "BAND-2025-001", new DateOnly(2028, 3, 15), 100m),
                CreateGoodsReceiptLine(batchMap["THER-2025-001"].Product, batchMap["THER-2025-001"], "THER-2025-001", new DateOnly(2028, 6, 1), 50m),
                CreateGoodsReceiptLine(batchMap["MASK-2025-001"].Product, batchMap["MASK-2025-001"], "MASK-2025-001", new DateOnly(2027, 9, 30), 200m),
                CreateGoodsReceiptLine(batchMap["HSAN-2025-001"].Product, batchMap["HSAN-2025-001"], "HSAN-2025-001", new DateOnly(2027, 5, 20), 100m)
            ]);

        return [gr1, gr2, gr3, gr4, gr5];
    }

    private static GoodsReceipt CreateGoodsReceipt(string receiptNumber, Supplier supplier, Site site, StorageLocation location, DateTimeOffset receivedAt, string? notes, List<GoodsReceiptLine> lines)
    {
        GoodsReceipt receipt = new()
        {
            ReceiptNumber = receiptNumber,
            Supplier = supplier,
            Site = site,
            StorageLocation = location,
            ReceivedAtUtc = receivedAt,
            Status = "Posted",
            Notes = notes
        };

        foreach (GoodsReceiptLine line in lines)
        {
            line.GoodsReceipt = receipt;
            receipt.Lines.Add(line);
        }

        return receipt;
    }

    private static GoodsReceiptLine CreateGoodsReceiptLine(Product product, ProductBatch? batch, string batchNumber, DateOnly expiryDate, decimal quantity) => new()
    {
        Product = product,
        ProductBatch = batch,
        BatchNumber = batchNumber,
        ExpiryDate = expiryDate,
        Quantity = quantity
    };

    // ── Prescriptions ──────────────────────────────────────────────────

    private static List<Prescription> CreatePrescriptions(
        List<Product> products,
        List<ProductBatch> batches,
        Dictionary<string, Site> siteMap,
        Dictionary<string, StorageLocation> locationMap)
    {
        Dictionary<string, Product> productMap = products.ToDictionary(p => p.Sku);
        Dictionary<string, ProductBatch> batchMap = batches.ToDictionary(b => b.BatchNumber);

        Prescription rx1 = CreatePrescription("RX-20250120-001", siteMap["ST-HCM-01"], locationMap["LOC-ST-03"],
            "Nguyễn Văn An", "0901234567", "BS. Trần Minh", "BS-12345", "Pending",
            [
                CreatePrescriptionLine(productMap["PARA-500"], batchMap["PARA-2025-002"], 20m, 20m, "1 viên x 3 lần/ngày", "Sau ăn", "5 ngày", "Giảm đau hạ sốt"),
                CreatePrescriptionLine(productMap["AMOX-500"], batchMap["AMOX-2025-002"], 15m, 15m, "1 viên x 3 lần/ngày", "Trước ăn", "5 ngày", "Kháng sinh điều trị nhiễm trùng")
            ]);

        Prescription rx2 = CreatePrescription("RX-20250215-002", siteMap["ST-HCM-01"], locationMap["LOC-ST-03"],
            "Lê Thị Bình", "0912345678", "BS. Phạm Hương", "BS-67890", "Dispensed",
            [
                CreatePrescriptionLine(productMap["OMEP-20"], batchMap["OMEP-2025-002"], 30m, 30m, "1 viên x 2 lần/ngày", "Trước ăn sáng và tối", "14 ngày", "Điều trị viêm loét dạ dày"),
                CreatePrescriptionLine(productMap["CETI-10"], batchMap["CETI-2025-001"], 10m, 10m, "1 viên x 1 lần/ngày", "Tối", "10 ngày", "Giảm triệu chứng dị ứng")
            ]);

        Prescription rx3 = CreatePrescription("RX-20250301-003", siteMap["ST-HN-02"], locationMap["LOC-HN-05"],
            "Phạm Quốc Cường", "0923456789", "BS. Nguyễn Tùng", "BS-11223", "Draft",
            [
                CreatePrescriptionLine(productMap["METF-500"], batchMap["METF-2024-001"], 60m, 0m, "1 viên x 2 lần/ngày", "Sau ăn", "30 ngày", "Kiểm soát đường huyết"),
                CreatePrescriptionLine(productMap["AMLO-5"], batchMap["AMLO-2025-001"], 30m, 0m, "1 viên x 1 lần/ngày", "Sáng", "30 ngày", "Kiểm soát huyết áp")
            ]);

        Prescription rx4 = CreatePrescription("RX-20250310-004", siteMap["ST-DN-02"], locationMap["LOC-DN-04"],
            "Hoàng Thị Dung", "0934567890", "BS. Lê Khải", "BS-44556", "Pending",
            [
                CreatePrescriptionLine(productMap["CEFZ-500"], batchMap["CEFZ-2025-001"], 12m, 12m, "1 viên x 2 lần/ngày", "Sau ăn", "6 ngày", "Kháng sinh thế hệ 2"),
                CreatePrescriptionLine(productMap["VITC-100"], batchMap["VITC-2025-001"], 30m, 30m, "1 viên x 1 lần/ngày", "Sáng", "30 ngày", "Bổ sung vitamin C")
            ]);

        Prescription rx5 = CreatePrescription("RX-20250315-005", siteMap["ST-BD-01"], locationMap["LOC-BD-01"],
            "Đỗ Văn Em", "0945678901", "BS. Vũ Phương", "BS-77889", "Cancelled",
            [
                CreatePrescriptionLine(productMap["AZIT-500"], batchMap["AZIT-2025-001"], 6m, 0m, "1 viên x 1 lần/ngày", "Trước ăn", "3 ngày", "Kháng sinh macrolid - bệnh nhân dị ứng, hủy đơn")
            ]);

        return [rx1, rx2, rx3, rx4, rx5];
    }

    private static Prescription CreatePrescription(string number, Site site, StorageLocation location,
        string patientName, string patientPhone, string doctorName, string doctorLicense, string status,
        List<PrescriptionLine> lines)
    {
        Prescription prescription = new()
        {
            PrescriptionNumber = number,
            Site = site,
            StorageLocation = location,
            PatientName = patientName,
            PatientPhone = patientPhone,
            DoctorName = doctorName,
            DoctorLicense = doctorLicense,
            Status = status
        };

        foreach (PrescriptionLine line in lines)
        {
            line.Prescription = prescription;
            prescription.Lines.Add(line);
        }

        return prescription;
    }

    private static PrescriptionLine CreatePrescriptionLine(Product product, ProductBatch? batch,
        decimal prescribedQty, decimal dispensedQty, string? dosage, string? frequency, string? duration, string? notes) => new()
    {
        Product = product,
        ProductBatch = batch,
        PrescribedQuantity = prescribedQty,
        DispensedQuantity = dispensedQty,
        Dosage = dosage,
        Frequency = frequency,
        Duration = duration,
        Notes = notes
    };

    // ── Transfer Orders ────────────────────────────────────────────────

    private static List<TransferOrder> CreateTransferOrders(
        List<Product> products,
        List<ProductBatch> batches,
        Dictionary<string, Site> siteMap,
        Dictionary<string, StorageLocation> locationMap)
    {
        Dictionary<string, Product> productMap = products.ToDictionary(p => p.Sku);
        Dictionary<string, ProductBatch> batchMap = batches.ToDictionary(b => b.BatchNumber);

        TransferOrder to1 = CreateTransferOrder("TO-2025-0001",
            siteMap["WH-HCM-01"], locationMap["LOC-WH-03"],
            siteMap["ST-HCM-01"], locationMap["LOC-ST-02"],
            "Received", "Luân chuyển hàng cho Nhà thuốc Quận 1",
            [
                CreateTransferLine(productMap["PARA-500"], batchMap["PARA-2025-002"], 500m, 500m, 500m),
                CreateTransferLine(productMap["AMOX-500"], batchMap["AMOX-2025-002"], 300m, 300m, 300m),
                CreateTransferLine(productMap["CETI-10"], batchMap["CETI-2025-001"], 200m, 200m, 200m)
            ]);

        TransferOrder to2 = CreateTransferOrder("TO-2025-0002",
            siteMap["WH-HCM-01"], locationMap["LOC-WH-03"],
            siteMap["ST-HN-02"], locationMap["LOC-HN-04"],
            "InTransit", "Luân chuyển hàng cho Nhà thuốc Cầu Giấy qua kho HN",
            [
                CreateTransferLine(productMap["PARA-500"], batchMap["PARA-2024-001"], 400m, 400m, 0m),
                CreateTransferLine(productMap["OMEP-20"], batchMap["OMEP-2024-001"], 200m, 200m, 0m)
            ]);

        TransferOrder to3 = CreateTransferOrder("TO-2025-0003",
            siteMap["WH-HCM-01"], locationMap["LOC-WH-03"],
            siteMap["ST-DN-02"], locationMap["LOC-DN-04"],
            "Approved", "Luân chuyển hàng cho Nhà thuốc Hải Châu",
            [
                CreateTransferLine(productMap["VITC-100"], batchMap["VITC-2025-001"], 600m, 0m, 0m),
                CreateTransferLine(productMap["AMLO-5"], batchMap["AMLO-2025-001"], 200m, 0m, 0m)
            ]);

        TransferOrder to4 = CreateTransferOrder("TO-2025-0004",
            siteMap["WH-HN-01"], locationMap["LOC-NWH-03"],
            siteMap["ST-HN-02"], locationMap["LOC-HN-04"],
            "Received", "Luân chuyển từ kho HN đến Nhà thuốc Cầu Giấy",
            [
                CreateTransferLine(productMap["AMOX-500"], batchMap["AMOX-2024-001"], 200m, 200m, 200m),
                CreateTransferLine(productMap["CEFZ-500"], batchMap["CEFZ-2025-001"], 150m, 150m, 150m)
            ]);

        TransferOrder to5 = CreateTransferOrder("TO-2025-0005",
            siteMap["WH-HCM-01"], locationMap["LOC-WH-03"],
            siteMap["ST-BD-01"], locationMap["LOC-BD-02"],
            "Draft", "Dự kiến luân chuyển hàng cho Nhà thuốc Bình Dương",
            [
                CreateTransferLine(productMap["METF-500"], batchMap["METF-2025-002"], 100m, 0m, 0m),
                CreateTransferLine(productMap["CLOP-75"], batchMap["CLOP-2025-001"], 80m, 0m, 0m)
            ]);

        return [to1, to2, to3, to4, to5];
    }

    private static TransferOrder CreateTransferOrder(string number,
        Site sourceSite, StorageLocation sourceLocation,
        Site destSite, StorageLocation destLocation,
        string status, string? notes,
        List<TransferOrderLine> lines)
    {
        TransferOrder order = new()
        {
            TransferNumber = number,
            SourceSite = sourceSite,
            SourceStorageLocation = sourceLocation,
            DestinationSite = destSite,
            DestinationStorageLocation = destLocation,
            Status = status,
            Notes = notes
        };

        foreach (TransferOrderLine line in lines)
        {
            line.TransferOrder = order;
            order.Lines.Add(line);
        }

        return order;
    }

    private static TransferOrderLine CreateTransferLine(Product product, ProductBatch batch,
        decimal requested, decimal shipped, decimal received) => new()
    {
        Product = product,
        ProductBatch = batch,
        RequestedQuantity = requested,
        ShippedQuantity = shipped,
        ReceivedQuantity = received
    };

    // ── Stocktake Sessions ─────────────────────────────────────────────

    private static List<StocktakeSession> CreateStocktakeSessions(
        List<Product> products,
        List<ProductBatch> batches,
        Dictionary<string, Site> siteMap,
        Dictionary<string, StorageLocation> locationMap)
    {
        Dictionary<string, Product> productMap = products.ToDictionary(p => p.Sku);
        Dictionary<string, ProductBatch> batchMap = batches.ToDictionary(b => b.BatchNumber);

        StocktakeSession ss1 = CreateStocktakeSession(siteMap["WH-HCM-01"], locationMap["LOC-WH-02"],
            "InProgress", new DateTimeOffset(2025, 3, 20, 8, 0, 0, TimeSpan.Zero), "Kiểm kê kho trung tâm Q1/2025",
            [
                CreateCountSheetLine(productMap["PARA-500"], batchMap["PARA-2025-002"], 5000m, 4980m, -20m, "Counted"),
                CreateCountSheetLine(productMap["AMOX-500"], batchMap["AMOX-2025-002"], 3000m, 3000m, 0m, "Counted"),
                CreateCountSheetLine(productMap["OMEP-20"], batchMap["OMEP-2025-002"], 2000m, 1995m, -5m, "Counted"),
                CreateCountSheetLine(productMap["VITC-100"], batchMap["VITC-2025-001"], 6000m, 0m, 0m, "Pending"),
                CreateCountSheetLine(productMap["IBUP-400"], batchMap["IBUP-2025-001"], 2500m, 0m, 0m, "Pending")
            ]);

        StocktakeSession ss2 = CreateStocktakeSession(siteMap["ST-HCM-01"], locationMap["LOC-ST-01"],
            "Completed", new DateTimeOffset(2025, 2, 28, 9, 0, 0, TimeSpan.Zero), "Kiểm kê Nhà thuốc Quận 1 tháng 2/2025",
            [
                CreateCountSheetLine(productMap["PARA-500"], batchMap["PARA-2025-002"], 200m, 200m, 0m, "Approved"),
                CreateCountSheetLine(productMap["AMOX-500"], batchMap["AMOX-2025-002"], 150m, 148m, -2m, "Approved"),
                CreateCountSheetLine(productMap["VITC-100"], batchMap["VITC-2025-001"], 300m, 305m, 5m, "Approved")
            ]);

        StocktakeSession ss3 = CreateStocktakeSession(siteMap["ST-HN-02"], locationMap["LOC-HN-03"],
            "Draft", new DateTimeOffset(2025, 4, 1, 8, 0, 0, TimeSpan.Zero), "Kiểm kê Nhà thuốc Cầu Giấy tháng 4/2025",
            [
                CreateCountSheetLine(productMap["PARA-500"], batchMap["PARA-2024-001"], 180m, 0m, 0m, "Pending"),
                CreateCountSheetLine(productMap["CEFZ-500"], batchMap["CEFZ-2025-001"], 100m, 0m, 0m, "Pending")
            ]);

        return [ss1, ss2, ss3];
    }

    private static StocktakeSession CreateStocktakeSession(Site site, StorageLocation location,
        string status, DateTimeOffset startedAt, string? notes, List<CountSheetLine> lines)
    {
        StocktakeSession session = new()
        {
            Site = site,
            StorageLocation = location,
            Status = status,
            StartedAtUtc = startedAt,
            Notes = notes
        };

        if (status == "Completed")
        {
            session.CompletedAtUtc = startedAt.AddHours(4);
        }

        foreach (CountSheetLine line in lines)
        {
            line.StocktakeSession = session;
            session.CountSheets.Add(line);
        }

        return session;
    }

    private static CountSheetLine CreateCountSheetLine(Product product, ProductBatch batch,
        decimal expected, decimal counted, decimal variance, string status) => new()
    {
        Product = product,
        ProductBatch = batch,
        ExpectedQuantity = expected,
        CountedQuantity = counted,
        Variance = variance,
        Status = status
    };

    // ── Stock Ledger Entries ───────────────────────────────────────────

    private static List<StockLedgerEntry> CreateStockLedgerEntries(
        List<Product> products,
        List<ProductBatch> batches,
        Dictionary<string, Site> siteMap,
        Dictionary<string, StorageLocation> locationMap)
    {
        Dictionary<string, Product> productMap = products.ToDictionary(p => p.Sku);
        Dictionary<string, ProductBatch> batchMap = batches.ToDictionary(b => b.BatchNumber);

        return
        [
            // GR-2025-0001 receipt entries
            CreateLedgerEntry(productMap["PARA-500"], batchMap["PARA-2025-002"],
                siteMap["WH-HCM-01"], locationMap["LOC-WH-02"],
                "Receipt", 2000m, 2000m, new DateTimeOffset(2025, 1, 15, 9, 0, 0, TimeSpan.Zero),
                "GoodsReceipt", null, "Nhập hàng từ DHG"),
            CreateLedgerEntry(productMap["VITC-100"], batchMap["VITC-2025-001"],
                siteMap["WH-HCM-01"], locationMap["LOC-WH-02"],
                "Receipt", 3000m, 3000m, new DateTimeOffset(2025, 1, 15, 9, 0, 0, TimeSpan.Zero),
                "GoodsReceipt", null, "Nhập hàng từ DHG"),

            // GR-2025-0002 receipt entries
            CreateLedgerEntry(productMap["AMOX-500"], batchMap["AMOX-2025-002"],
                siteMap["WH-HCM-01"], locationMap["LOC-WH-02"],
                "Receipt", 1500m, 3500m, new DateTimeOffset(2025, 2, 10, 8, 30, 0, TimeSpan.Zero),
                "GoodsReceipt", null, "Nhập hàng từ Traphaco"),
            CreateLedgerEntry(productMap["IBUP-400"], batchMap["IBUP-2025-001"],
                siteMap["WH-HCM-01"], locationMap["LOC-WH-02"],
                "Receipt", 1000m, 1000m, new DateTimeOffset(2025, 2, 10, 8, 30, 0, TimeSpan.Zero),
                "GoodsReceipt", null, "Nhập hàng từ Traphaco"),

            // Transfer out from WH-HCM-01 to ST-HCM-01
            CreateLedgerEntry(productMap["PARA-500"], batchMap["PARA-2025-002"],
                siteMap["WH-HCM-01"], locationMap["LOC-WH-02"],
                "TransferOut", -500m, 1500m, new DateTimeOffset(2025, 2, 15, 10, 0, 0, TimeSpan.Zero),
                "TransferOrder", null, "Xuất cho Nhà thuốc Quận 1"),
            CreateLedgerEntry(productMap["PARA-500"], batchMap["PARA-2025-002"],
                siteMap["ST-HCM-01"], locationMap["LOC-ST-02"],
                "TransferIn", 500m, 500m, new DateTimeOffset(2025, 2, 15, 14, 0, 0, TimeSpan.Zero),
                "TransferOrder", null, "Nhận từ kho trung tâm"),

            // Prescription dispensed
            CreateLedgerEntry(productMap["PARA-500"], batchMap["PARA-2025-002"],
                siteMap["ST-HCM-01"], locationMap["LOC-ST-01"],
                "Dispensed", -10m, 190m, new DateTimeOffset(2025, 2, 16, 10, 0, 0, TimeSpan.Zero),
                "Prescription", null, "Xuất theo đơn RX-20250215-002"),

            // Stock adjustment from completed stocktake
            CreateLedgerEntry(productMap["AMOX-500"], batchMap["AMOX-2025-002"],
                siteMap["ST-HCM-01"], locationMap["LOC-ST-01"],
                "Adjustment", -2m, 148m, new DateTimeOffset(2025, 2, 28, 13, 0, 0, TimeSpan.Zero),
                "StockAdjustment", null, "Điều chỉnh sau kiểm kê: thiếu 2 hộp")
        ];
    }

    private static StockLedgerEntry CreateLedgerEntry(Product product, ProductBatch batch,
        Site site, StorageLocation location,
        string movementType, decimal quantityDelta, decimal balanceAfter, DateTimeOffset occurredAt,
        string? referenceType, Guid? referenceId, string? reason) => new()
    {
        Product = product,
        ProductBatch = batch,
        Site = site,
        StorageLocation = location,
        MovementType = movementType,
        QuantityDelta = quantityDelta,
        BalanceAfter = balanceAfter,
        OccurredAtUtc = occurredAt,
        ReferenceType = referenceType,
        ReferenceId = referenceId,
        Reason = reason
    };

    // ── Enum Parsers ───────────────────────────────────────────────────

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
