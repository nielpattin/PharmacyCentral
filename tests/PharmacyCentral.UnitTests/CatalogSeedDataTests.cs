using System.Reflection;
using PharmacyCentral.Domain.Pricing;
using PharmacyCentral.Domain.Products;
using PharmacyCentral.Domain.Sites;
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
