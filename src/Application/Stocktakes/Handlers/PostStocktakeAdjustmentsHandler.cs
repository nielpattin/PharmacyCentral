using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Inventory.Commands;
using PharmacyCentral.Application.Inventory.Handlers;
using PharmacyCentral.Application.Stocktakes.Commands;
using PharmacyCentral.Application.Stocktakes.Models;
using PharmacyCentral.Domain.Inventory;
using PharmacyCentral.Domain.Stocktakes;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Stocktakes.Handlers;

public sealed class PostStocktakeAdjustmentsHandler(
    IApplicationDbContext dbContext,
    StockMovementRecorder stockMovementRecorder)
{
    public async Task<Result<IReadOnlyList<StockAdjustmentDetails>>> HandleAsync(
        PostStocktakeAdjustmentsCommand command,
        CancellationToken cancellationToken)
    {
        StocktakeSession? session = await dbContext.GetStocktakeSessionByIdAsync(command.StocktakeSessionId, cancellationToken);
        if (session is null)
        {
            return StocktakeErrors.SessionNotFound(command.StocktakeSessionId);
        }

        if (session.Status != StocktakeStatus.InProgress)
        {
            return StocktakeErrors.InvalidStatus(session.Status);
        }

        List<CountSheetLine> lines = await dbContext.ListCountSheetLinesWithVarianceAsync(session.Id, cancellationToken);
        if (lines.Count == 0)
        {
            return StocktakeErrors.NoVarianceToAdjust();
        }

        List<StockAdjustmentDetails> details = [];

        foreach (CountSheetLine line in lines)
        {
            string adjustmentType = line.Variance > 0 ? AdjustmentType.Positive : AdjustmentType.Negative;
            decimal quantity = Math.Abs(line.Variance);

            StockAdjustment adjustment = new()
            {
                Id = Guid.NewGuid(),
                StocktakeSessionId = session.Id,
                StocktakeSession = session,
                ProductId = line.ProductId,
                ProductBatchId = line.ProductBatchId,
                SiteId = session.SiteId,
                StorageLocationId = session.StorageLocationId,
                AdjustmentType = adjustmentType,
                Quantity = quantity,
                Reason = "Stocktake variance",
                ApprovedByUserId = command.ApprovedByUserId,
                ApprovedAtUtc = DateTimeOffset.UtcNow,
                Status = AdjustmentStatus.Approved,
                Notes = line.Notes,
                CreatedByUserId = session.CreatedByUserId
            };

            await dbContext.AddAsync(adjustment, cancellationToken);

            RecordStockMovementCommand movementCommand = new()
            {
                ProductId = line.ProductId,
                ProductBatchId = line.ProductBatchId,
                SiteId = session.SiteId,
                StorageLocationId = session.StorageLocationId,
                MovementType = "StocktakeAdjustment",
                QuantityDelta = line.Variance,
                OccurredAtUtc = adjustment.ApprovedAtUtc,
                ReferenceType = "StocktakeSession",
                ReferenceId = session.Id,
                Reason = adjustment.Reason,
                Notes = adjustment.Notes,
                CreatedByUserId = command.ApprovedByUserId
            };

            Result<StockLedgerEntry> movementResult = await stockMovementRecorder.RecordAsync(movementCommand, cancellationToken);
            if (movementResult.IsFailure)
            {
                return movementResult.Error;
            }

            line.Status = CountLineStatus.Approved;
            details.Add(StockAdjustmentDetails.From(adjustment));
        }

        session.Status = StocktakeStatus.Completed;
        session.CompletedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        return details;
    }
}
