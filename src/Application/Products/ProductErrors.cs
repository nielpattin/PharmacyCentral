using SharedKernel.Results;

namespace PharmacyCentral.Application.Products;

internal static class ProductErrors
{
    public static Error NotFound(Guid productId) =>
        new("products.not_found", $"Product '{productId}' was not found.");

    public static Error DuplicateSku(string sku) =>
        new("products.duplicate_sku", $"Product SKU '{sku}' is already in use.");

    public static Error UnitsRequired() =>
        new("products.units_required", "At least one product unit is required.");

    public static Error ExactlyOneBaseUnitRequired() =>
        new("products.base_unit_required", "Exactly one base unit is required.");

    public static Error InvalidUnitConversion() =>
        new("products.invalid_unit_conversion", "Product unit conversion factor must be greater than zero.");

    public static Error DuplicateUnitName(string unitName) =>
        new("products.duplicate_unit_name", $"Product unit '{unitName}' is duplicated.");
}

