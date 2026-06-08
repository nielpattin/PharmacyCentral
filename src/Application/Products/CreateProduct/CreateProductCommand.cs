namespace PharmacyCentral.Application.Products.CreateProduct;

public sealed record CreateProductCommand
{
    public string Sku { get; init; } = string.Empty;
    public string? Barcode { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? Category { get; init; }
    public string? Manufacturer { get; init; }
    public string? Status { get; init; }
    public string? Notes { get; init; }
    public bool? IsActive { get; init; }
    public List<ProductUnitCommandItem> Units { get; init; } = [];
}

public sealed record ProductUnitCommandItem
{
    public Guid? Id { get; init; }
    public string UnitName { get; init; } = string.Empty;
    public decimal ConversionFactorToBaseUnit { get; init; } = 1m;
    public bool IsBaseUnit { get; init; }
    public bool IsDefaultSaleUnit { get; init; }
    public bool IsDefaultPurchaseUnit { get; init; }
    public string? Barcode { get; init; }
    public int SortOrder { get; init; }
}
