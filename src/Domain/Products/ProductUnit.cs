namespace PharmacyCentral.Domain.Products;

public sealed class ProductUnit
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string UnitName { get; set; } = string.Empty;
    public decimal ConversionFactorToBaseUnit { get; set; } = 1m;
    public bool IsBaseUnit { get; set; }
    public bool IsDefaultSaleUnit { get; set; }
    public bool IsDefaultPurchaseUnit { get; set; }
    public string? Barcode { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }

    public Product Product { get; set; } = null!;

    public decimal ToBaseQuantity(decimal quantity) => quantity * ConversionFactorToBaseUnit;
}
