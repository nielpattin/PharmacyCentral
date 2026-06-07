using PharmacyCentral.Application.Products.Shared;
using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.UnitTests;

public sealed class ProductDetailsTests
{
    [Fact]
    public void ProductDetails_includes_optional_barcode_for_counter_scan_lookup()
    {
        Product product = new()
        {
            Id = Guid.NewGuid(),
            Sku = "MED-001",
            Barcode = "8938505974190",
            Name = "Paracetamol",
            Status = "Active",
            IsActive = true,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        ProductDetails details = ProductDetails.From(product);

        Assert.Equal("8938505974190", details.Barcode);
    }
}
