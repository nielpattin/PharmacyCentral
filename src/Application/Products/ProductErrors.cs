using SharedKernel.Results;

namespace PharmacyCentral.Application.Products;

internal static class ProductErrors
{
    public static Error NotFound(Guid productId) =>
        new("products.not_found", $"Product '{productId}' was not found.");

    public static Error DuplicateSku(string sku) =>
        new("products.duplicate_sku", $"Product SKU '{sku}' is already in use.");
}

