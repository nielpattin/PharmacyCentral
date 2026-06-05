using PharmacyCentral.Domain.Suppliers;

namespace PharmacyCentral.Application.Suppliers.Shared;

public sealed record SupplierDetails(Guid Id, string Code, string Name, string? ContactName, string? Email, string? Phone, string? Address, string Status, string? Notes, bool IsActive, DateTimeOffset CreatedAtUtc, DateTimeOffset UpdatedAtUtc)
{
    public static SupplierDetails From(Supplier supplier) =>
        new(supplier.Id, supplier.Code, supplier.Name, supplier.ContactName, supplier.Email, supplier.Phone, supplier.Address, supplier.Status, supplier.Notes, supplier.IsActive, supplier.CreatedAtUtc, supplier.UpdatedAtUtc);
}

