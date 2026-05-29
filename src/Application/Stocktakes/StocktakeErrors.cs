using PharmacyCentral.Application.Inventory;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Stocktakes;

internal static class StocktakeErrors
{
    public static Error SessionNotFound(Guid sessionId) => new("stocktakes.session_not_found", $"Stocktake session '{sessionId}' was not found.");

    public static Error SessionAlreadyCompleted(Guid sessionId) => new("stocktakes.session_already_completed", $"Stocktake session '{sessionId}' is already completed.");

    public static Error InvalidStatus(string status) => new("stocktakes.invalid_status", $"Stocktake status '{status}' is invalid for this operation.");

    public static Error CountLineNotFound(Guid productBatchId) => new("stocktakes.count_line_not_found", $"Count line for batch '{productBatchId}' was not found.");

    public static Error CountLinesRequired() => new("stocktakes.count_lines_required", "At least one count line is required.");

    public static Error InvalidCountQuantity() => new("stocktakes.invalid_count_quantity", "Counted quantity cannot be negative.");

    public static Error NoVarianceToAdjust() => new("stocktakes.no_variance_to_adjust", "No count lines with variance found. Nothing to adjust.");

    public static Error AdjustmentNotFound(Guid adjustmentId) => new("stocktakes.adjustment_not_found", $"Stock adjustment '{adjustmentId}' was not found.");

    public static Error AdjustmentAlreadyProcessed(Guid adjustmentId) => new("stocktakes.adjustment_already_processed", $"Stock adjustment '{adjustmentId}' has already been processed.");

    public static Error InvalidAdjustmentType(string adjustmentType) => new("stocktakes.invalid_adjustment_type", $"Adjustment type '{adjustmentType}' is invalid. Must be 'Positive' or 'Negative'.");

    public static Error InvalidAdjustmentQuantity() => new("stocktakes.invalid_adjustment_quantity", "Adjustment quantity must be greater than zero.");

    public static Error ReasonRequired() => new("stocktakes.reason_required", "Reason is required.");

    public static Error CreatorCannotApprove() => new("stocktakes.creator_cannot_approve", "Creator and approver must be separated.");

    public static Error DuplicateCountLine(Guid productBatchId) => new("stocktakes.duplicate_count_line", $"A count line for batch '{productBatchId}' already exists in this session.");

    public static Error ProductNotFound(Guid productId) => InventoryErrors.ProductNotFound(productId);

    public static Error SiteNotFound(Guid siteId) => InventoryErrors.SiteNotFound(siteId);

    public static Error StorageLocationNotFound(Guid storageLocationId) => InventoryErrors.StorageLocationNotFound(storageLocationId);

    public static Error StorageLocationSiteMismatch(Guid storageLocationId, Guid siteId) => InventoryErrors.StorageLocationSiteMismatch(storageLocationId, siteId);
}
