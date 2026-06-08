using System.Reflection;
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
using PharmacyCentral.Infrastructure.Persistence;

namespace PharmacyCentral.UnitTests;

public sealed class CatalogSeedDataTests
{
    [Fact]
    public void Catalog_seed_sites_include_one_site_per_site_type()
    {
        List<Site> sites = InvokeSeederFactory<List<Site>>("CreateSites");

        Assert.Equal(4, sites.Count);
        Assert.Equal(Enum.GetValues<SiteType>().OrderBy(value => value), sites.Select(site => site.SiteType).OrderBy(value => value));
    }

    [Fact]
    public void Catalog_seed_sites_include_storage_locations_required_by_business_data()
    {
        List<Site> sites = InvokeSeederFactory<List<Site>>("CreateSites");
        List<StorageLocation> locations = sites.SelectMany(site => site.StorageLocations).ToList();

        Assert.Equal(6, locations.Count);
        Assert.Contains(sites, site => site.Code == "WH-HCM-01" && site.StorageLocations.Any(location => location.Code == "LOC-WH-01" && location.Name == "Kho lưu trữ"));
        Assert.Contains(sites, site => site.Code == "WH-HCM-01" && site.StorageLocations.Any(location => location.Code == "LOC-WH-02" && location.Name == "Khu receiving"));
        Assert.Contains(sites, site => site.Code == "ST-HCM-01" && site.StorageLocations.Any(location => location.Code == "LOC-ST-01" && location.Name == "Quầy bán hàng"));
        Assert.Contains(sites, site => site.Code == "ST-HCM-01" && site.StorageLocations.Any(location => location.Code == "LOC-ST-02" && location.Name == "Kho trong"));
    }

    [Fact]
    public void Catalog_seed_business_related_data_uses_existing_site_and_location_codes()
    {
        List<Site> sites = InvokeSeederFactory<List<Site>>("CreateSites");
        Dictionary<string, Site> siteMap = sites.ToDictionary(site => site.Code);
        Dictionary<string, StorageLocation> locationMap = sites
            .SelectMany(site => site.StorageLocations)
            .ToDictionary(location => location.Code);
        List<Supplier> suppliers = InvokeSeederFactory<List<Supplier>>("CreateSuppliers");
        List<Product> products = InvokeSeederFactory<List<Product>>("CreateProducts");
        List<ProductBatch> batches = InvokeSeederFactory<List<ProductBatch>>("CreateProductBatches", products, suppliers);
        Dictionary<string, ProductBatch> batchMap = batches.ToDictionary(batch => batch.BatchNumber);

        List<InventoryBalance> balances = InvokeSeederFactory<List<InventoryBalance>>("CreateInventoryBalances", batchMap, siteMap, locationMap);
        List<GoodsReceipt> goodsReceipts = InvokeSeederFactory<List<GoodsReceipt>>("CreateGoodsReceipts", suppliers, products, batches, siteMap, locationMap);
        List<Prescription> prescriptions = InvokeSeederFactory<List<Prescription>>("CreatePrescriptions", products, batches, siteMap, locationMap);
        List<TransferOrder> transferOrders = InvokeSeederFactory<List<TransferOrder>>("CreateTransferOrders", products, batches, siteMap, locationMap);
        List<StocktakeSession> stocktakeSessions = InvokeSeederFactory<List<StocktakeSession>>("CreateStocktakeSessions", products, batches, siteMap, locationMap);
        List<StockLedgerEntry> ledgerEntries = InvokeSeederFactory<List<StockLedgerEntry>>("CreateStockLedgerEntries", products, batches, siteMap, locationMap);

        Assert.NotEmpty(balances);
        Assert.NotEmpty(goodsReceipts);
        Assert.NotEmpty(prescriptions);
        Assert.NotEmpty(transferOrders);
        Assert.NotEmpty(stocktakeSessions);
        Assert.NotEmpty(ledgerEntries);
    }

    [Fact]
    public void Catalog_seed_products_use_smallest_sale_unit_as_base_unit()
    {
        List<Product> products = InvokeSeederFactory<List<Product>>("CreateProducts");

        Product paracetamol = Assert.Single(products, product => product.Sku == "PARA-500");
        ProductUnit baseUnit = Assert.Single(paracetamol.Units, unit => unit.IsBaseUnit);
        ProductUnit stripUnit = Assert.Single(paracetamol.Units, unit => unit.UnitName == "Vỉ");
        ProductUnit boxUnit = Assert.Single(paracetamol.Units, unit => unit.UnitName == "Hộp");

        Assert.Equal("Viên", baseUnit.UnitName);
        Assert.Equal(1m, baseUnit.ConversionFactorToBaseUnit);
        Assert.Equal(10m, stripUnit.ConversionFactorToBaseUnit);
        Assert.Equal(100m, boxUnit.ConversionFactorToBaseUnit);
    }

    [Fact]
    public void Catalog_seed_prices_include_published_prices_for_each_product_unit()
    {
        List<Product> products = InvokeSeederFactory<List<Product>>("CreateProducts");
        List<ProductPrice> prices = InvokeSeederFactory<List<ProductPrice>>("CreateProductPrices", products);

        Assert.Equal(products.Sum(product => product.Units.Count), prices.Count);
        Assert.All(prices, price =>
        {
            Assert.Equal(ProductPriceStatus.Published, price.Status);
            Assert.NotNull(price.Product);
            Assert.NotNull(price.ProductUnit);
            Assert.Contains(price.ProductUnit, price.Product.Units);
            Assert.True(price.UnitPrice > 0m);
        });
    }

    private static T InvokeSeederFactory<T>(string methodName, params object[] arguments)
    {
        Type seederType = typeof(PharmacyCentralDbContext).Assembly.GetType("PharmacyCentral.Infrastructure.Seeding.DatabaseSeederHostedService")
            ?? throw new InvalidOperationException("Seeder type was not found.");
        MethodInfo method = seederType.GetMethod(methodName, BindingFlags.NonPublic | BindingFlags.Static)
            ?? throw new InvalidOperationException($"Seeder method '{methodName}' was not found.");
        return (T)(method.Invoke(null, arguments) ?? throw new InvalidOperationException($"Seeder method '{methodName}' returned null."));
    }
}
