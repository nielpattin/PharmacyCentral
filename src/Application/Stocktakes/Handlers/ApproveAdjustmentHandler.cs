using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Stocktakes.Commands;
using PharmacyCentral.Application.Stocktakes.Models;
using PharmacyCentral.Domain.Stocktakes;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Stocktakes.Handlers;

public sealed class ApproveAdjustmentHandler(
    IApplicationDbContext dbContext,
    StockAdjustmentMovementService movementService)
{
    public async Task<Result<StockAdjustmentDetails>> HandleAsync(ApproveAdjustmentCommand command, CancellationToken cancellationToken)
    {
        StockAdjustment? adjustment = await dbContext.GetStockAdjustmentByIdAsync(command.AdjustmentId, cancellationToken);
        if (adjustment is null)
        {
            return StocktakeErrors.AdjustmentNotFound(command.AdjustmentId);
        }

        if (adjustment.Status != AdjustmentStatus.Pending)
        {
            return StocktakeErrors.AdjustmentAlreadyProcessed(adjustment.Id);
        }

        if (adjustment.CreatedByUserId == command.ApprovedByUserId)
        {
            return StocktakeErrors.CreatorCannotApprove();
        }

        adjustment.Status = AdjustmentStatus.Approved;
        adjustment.ApprovedByUserId = command.ApprovedByUserId;
        adjustment.ApprovedAtUtc = DateTimeOffset.UtcNow;
        adjustment.Notes = MergeNotes(adjustment.Notes, command.ApprovalNotes);

        Result<Domain.Inventory.StockLedgerEntry> movementResult = await movementService.PostMovementAsync(adjustment, command.ApprovedByUserId, cancellationToken);
        if (movementResult.IsFailure)
        {
            return movementResult.Error;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return StockAdjustmentDetails.From(adjustment);
    }

    private static string? MergeNotes(string? notes, string? approvalNotes)
    {
        if (string.IsNullOrWhiteSpace(approvalNotes))
        {
            return notes;
        }

        return string.IsNullOrWhiteSpace(notes) ? approvalNotes.Trim() : $"{notes.Trim()}\nApproval: {approvalNotes.Trim()}";
    }
}
