using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Inventory.Commands;
using PharmacyCentral.Application.Inventory.Handlers;
using PharmacyCentral.Application.Inventory.Models;
using PharmacyCentral.Application.Returns.Commands;
using PharmacyCentral.Domain.Inventory;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Returns.Handlers;

public sealed class CreateReturnHandler(IApplicationDbContext dbContext, StockMovementRecorder stockMovementRecorder, AuditLogService auditLogService)
{
    public async Task<Result<StockLedgerEntryDetails>> HandleAsync(CreateReturnCommand command, CancellationToken cancellationToken)
    {
        if (command.Quantity <= 0)
        {
            return ReturnsErrors.InvalidQuantity();
        }

        string reason = NormalizeRequired(command.Reason);
        if (!ReturnsConstants.Reasons.Contains(reason))
        {
            return ReturnsErrors.InvalidReason(reason);
        }

        RecordStockMovementCommand movementCommand = new()
        {
            ProductId = command.ProductId,
            ProductBatchId = command.ProductBatchId,
            SiteId = command.SiteId,
            StorageLocationId = command.StorageLocationId,
            MovementType = ReturnsConstants.MovementTypeForReason(reason),
            QuantityDelta = -command.Quantity,
            OccurredAtUtc = command.OccurredAtUtc,
            ReferenceType = ReturnsConstants.ReferenceType,
            Reason = reason,
            Notes = NormalizeReturnNotes(command.Destination, command.Notes),
            CreatedByUserId = command.CreatedByUserId
        };

        Result<StockLedgerEntry> movementResult = await stockMovementRecorder.RecordAsync(movementCommand, cancellationToken);
        if (movementResult.IsFailure)
        {
            return movementResult.Error;
        }

        await auditLogService.RecordAsync(
            AuditActions.Posted,
            AuditEntityTypes.StockLedgerEntry,
            movementResult.Value.Id,
            command.CreatedByUserId,
            command.SiteId,
            $"Posted return movement {movementCommand.MovementType}",
            cancellationToken: cancellationToken);

        await dbContext.SaveChangesAsync(cancellationToken);

        return StockLedgerEntryDetails.From(movementResult.Value);
    }

    private static string NormalizeRequired(string value) => value.Trim();

    private static string? NormalizeReturnNotes(string? destination, string? notes)
    {
        string? normalizedDestination = NormalizeOptional(destination);
        string? normalizedNotes = NormalizeOptional(notes);

        if (normalizedDestination is null)
        {
            return normalizedNotes;
        }

        if (normalizedNotes is null)
        {
            return $"Destination: {normalizedDestination}";
        }

        return $"Destination: {normalizedDestination}. {normalizedNotes}";
    }

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
