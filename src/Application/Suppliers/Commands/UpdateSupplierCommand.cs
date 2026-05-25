namespace PharmacyCentral.Application.Suppliers.Commands;

public sealed record UpdateSupplierCommand
{
    public string Code { get; init; } = string.Empty;

    public string Name { get; init; } = string.Empty;

    public string? ContactName { get; init; }

    public string? Email { get; init; }

    public string? Phone { get; init; }

    public string? Address { get; init; }

    public string? Status { get; init; }

    public string? Notes { get; init; }

    public bool? IsActive { get; init; }
}

