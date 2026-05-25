namespace PharmacyCentral.Application.Products.Commands;

public sealed record UpdateProductCommand
{
    public string Sku { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public string? Category { get; init; }

    public string? Unit { get; init; }

    public string? Manufacturer { get; init; }

    public string? Status { get; init; }

    public string? Notes { get; init; }

    public bool? IsActive { get; init; }
}

