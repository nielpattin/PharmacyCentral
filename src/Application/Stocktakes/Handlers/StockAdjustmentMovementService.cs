using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Inventory.Commands;
using PharmacyCentral.Application.Inventory.Handlers;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Stocktakes;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Stocktakes.Handlers;

public sealed class StockAdjustmentMovementService(StockMovementRecorder stockMovementRecorder)
{
    public async Task<Result<StockLedgerEntry>> PostMovementAsync(
        StockAdjustment adjustment,
        Guid approvedByUserId,
        CancellationToken cancellationToken)
    {
        RecordStockMovementCommand movementCommand = new()
        {
            ProductId = adjustment.ProductId,
            ProductBatchId = adjustment.ProductBatchId,
            SiteId = adjustment.SiteId,
            StorageLocationId = adjustment.StorageLocationId,
            MovementType = "StocktakeAdjustment",
            QuantityDelta = adjustment.AdjustmentType == AdjustmentType.Negative
                ? -adjustment.Quantity
                : adjustment.Quantity,
            OccurredAtUtc = adjustment.ApprovedAtUtc ?? DateTimeOffset.UtcNow,
            ReferenceType = "StockAdjustment",
            ReferenceId = adjustment.Id,
            Reason = adjustment.Reason,
            Notes = adjustment.Notes,
            CreatedByUserId = approvedByUserId
        };

        return await stockMovementRecorder.RecordAsync(movementCommand, cancellationToken);
    }
}
