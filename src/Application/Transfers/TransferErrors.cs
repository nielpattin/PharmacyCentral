using SharedKernel.Results;

namespace PharmacyCentral.Application.Transfers;

internal static class TransferErrors
{
    public static Error TransferNotFound(Guid transferId) =>
        new("transfers.transfer_not_found", $"Transfer order '{transferId}' was not found.");

    public static Error InvalidStatus(string status) =>
        new("transfers.invalid_status", $"Transfer status '{status}' is invalid for this operation.");

    public static Error SourceAndDestinationSame() =>
        new("transfers.source_and_destination_same", "Source and destination must be different.");

    public static Error InsufficientStock(decimal balanceAfter) =>
        new("transfers.insufficient_stock", $"Transfer would leave source stock at {balanceAfter}.");

    public static Error QuantityMismatch(decimal received, decimal shipped) =>
        new("transfers.quantity_mismatch", $"Received quantity {received} does not match shipped quantity {shipped}.");

    public static Error TransferAlreadyCompleted() =>
        new("transfers.transfer_already_completed", "Transfer order has already been completed or cancelled.");

    public static Error CreatorCannotApprove() =>
        new("transfers.creator_cannot_approve", "The creator of a transfer cannot approve it.");

    public static Error SourceStorageLocationMismatch(Guid storageLocationId, Guid siteId) =>
        new("transfers.source_storage_location_mismatch", $"Source storage location '{storageLocationId}' does not belong to source site '{siteId}'.");

    public static Error DestinationStorageLocationMismatch(Guid storageLocationId, Guid siteId) =>
        new("transfers.destination_storage_location_mismatch", $"Destination storage location '{storageLocationId}' does not belong to destination site '{siteId}'.");

    public static Error LinesRequired() =>
        new("transfers.lines_required", "At least one transfer line is required.");

    public static Error DuplicateProductBatch(Guid productBatchId) =>
        new("transfers.duplicate_product_batch", $"A line for batch '{productBatchId}' already exists in this transfer.");
}
