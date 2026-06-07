using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.Application.Products.Shared;

public sealed record ProductDetails(Guid Id, string Sku, string? Barcode, string Name, string? Category, string? Unit, string? Manufacturer, string Status, string? Notes, bool IsActive, DateTimeOffset CreatedAtUtc, DateTimeOffset UpdatedAtUtc)
{
    public static ProductDetails From(Product product) =>
        new(product.Id, product.Sku, product.Barcode, product.Name, product.Category, product.Unit, product.Manufacturer, product.Status, product.Notes, product.IsActive, product.CreatedAtUtc, product.UpdatedAtUtc);
}

