using SharedKernel.Results;

namespace PharmacyCentral.Application.Inventory;

internal static class InventoryErrors
{
    public static Error ProductNotFound(Guid productId) =>
        new("inventory.product_not_found", $"Product '{productId}' was not found.");

    public static Error SiteNotFound(Guid siteId) =>
        new("inventory.site_not_found", $"Site '{siteId}' was not found.");

    public static Error StorageLocationNotFound(Guid storageLocationId) =>
        new("inventory.storage_location_not_found", $"Storage location '{storageLocationId}' was not found.");

    public static Error StorageLocationSiteMismatch(Guid storageLocationId, Guid siteId) =>
        new("inventory.storage_location_site_mismatch", $"Storage location '{storageLocationId}' does not belong to site '{siteId}'.");

    public static Error BatchNotFound(Guid productBatchId) =>
        new("inventory.batch_not_found", $"Product batch '{productBatchId}' was not found.");

    public static Error BatchRequired() =>
        new("inventory.batch_required", "Product batch id or batch number with expiry date is required.");

    public static Error BatchProductMismatch(Guid productBatchId, Guid productId) =>
        new("inventory.batch_product_mismatch", $"Product batch '{productBatchId}' does not belong to product '{productId}'.");

    public static Error InvalidQuantityDelta() =>
        new("inventory.invalid_quantity_delta", "Quantity delta must not be zero.");

    public static Error InsufficientStock(decimal balanceAfter) =>
        new("inventory.insufficient_stock", $"Stock movement would leave quantity on hand at {balanceAfter}.");
}
