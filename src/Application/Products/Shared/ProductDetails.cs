using PharmacyCentral.Domain.Products;

namespace PharmacyCentral.Application.Products.Shared;

public sealed record ProductDetails(
    Guid Id,
    string Sku,
    string? Barcode,
    string Name,
    string? Category,
    string? Unit,
    string? BaseUnitName,
    string? Manufacturer,
    string Status,
    string? Notes,
    bool IsActive,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<ProductUnitDetails> Units)
{
    public static ProductDetails From(Product product)
    {
        List<ProductUnitDetails> units = product.Units
            .OrderBy(unit => unit.SortOrder)
            .ThenBy(unit => unit.UnitName)
            .Select(ProductUnitDetails.From)
            .ToList();
        string? baseUnitName = units.FirstOrDefault(unit => unit.IsBaseUnit)?.UnitName;

        return new(
            product.Id,
            product.Sku,
            product.Barcode,
            product.Name,
            product.Category,
            baseUnitName,
            baseUnitName,
            product.Manufacturer,
            product.Status,
            product.Notes,
            product.IsActive,
            product.CreatedAtUtc,
            product.UpdatedAtUtc,
            units);
    }
}

public sealed record ProductUnitDetails(
    Guid Id,
    Guid ProductId,
    string UnitName,
    decimal ConversionFactorToBaseUnit,
    bool IsBaseUnit,
    bool IsDefaultSaleUnit,
    bool IsDefaultPurchaseUnit,
    string? Barcode,
    int SortOrder)
{
    public static ProductUnitDetails From(ProductUnit unit) => new(
        unit.Id,
        unit.ProductId,
        unit.UnitName,
        unit.ConversionFactorToBaseUnit,
        unit.IsBaseUnit,
        unit.IsDefaultSaleUnit,
        unit.IsDefaultPurchaseUnit,
        unit.Barcode,
        unit.SortOrder);
}
