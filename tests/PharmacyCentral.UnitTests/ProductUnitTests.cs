using PharmacyCentral.Application.Products.Shared;
using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.UnitTests;

public sealed class ProductUnitTests
{
    [Fact]
    public void ProductUnit_converts_sale_quantity_to_base_quantity()
    {
        ProductUnit strip = new()
        {
            UnitName = "Vỉ",
            ConversionFactorToBaseUnit = 10m,
            IsBaseUnit = false
        };

        decimal baseQuantity = strip.ToBaseQuantity(2m);

        Assert.Equal(20m, baseQuantity);
    }

    [Fact]
    public void ProductDetails_exposes_structured_units_for_each_product()
    {
        Product product = new()
        {
            Id = Guid.NewGuid(),
            Sku = "PARA-500",
            Name = "Paracetamol 500mg",
            Category = "Giảm đau hạ sốt",
            Manufacturer = "Công ty CP Dược Hậu Giang",
            Status = "Active",
            IsActive = true,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };
        product.Units.Add(new ProductUnit
        {
            Id = Guid.NewGuid(),
            ProductId = product.Id,
            UnitName = "Viên",
            ConversionFactorToBaseUnit = 1m,
            IsBaseUnit = true,
            IsDefaultSaleUnit = true,
            SortOrder = 1
        });
        product.Units.Add(new ProductUnit
        {
            Id = Guid.NewGuid(),
            ProductId = product.Id,
            UnitName = "Vỉ",
            ConversionFactorToBaseUnit = 10m,
            IsDefaultSaleUnit = true,
            SortOrder = 2
        });

        ProductDetails details = ProductDetails.From(product);

        Assert.Equal("Viên", details.BaseUnitName);
        Assert.Equal(2, details.Units.Count);
        Assert.Equal("Vỉ", details.Units[1].UnitName);
        Assert.Equal(10m, details.Units[1].ConversionFactorToBaseUnit);
    }
}
