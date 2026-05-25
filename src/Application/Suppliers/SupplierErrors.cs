using SharedKernel.Results;

namespace PharmacyCentral.Application.Suppliers;

internal static class SupplierErrors
{
    public static Error NotFound(Guid supplierId) =>
        new("suppliers.not_found", $"Supplier '{supplierId}' was not found.");

    public static Error DuplicateCode(string code) =>
        new("suppliers.duplicate_code", $"Supplier code '{code}' is already in use.");
}

