namespace PharmacyCentral.Application.Products.CreateProduct;

public sealed record CreateProductCommand
{
    public string Sku { get; init; } = string.Empty;
    public string? Barcode { get; init; }


    public string Name { get; init; } = string.Empty;

    public string? Category { get; init; }

    public string? Unit { get; init; }

    public string? Manufacturer { get; init; }

    public string? Status { get; init; }

    public string? Notes { get; init; }

    public bool? IsActive { get; init; }
}

