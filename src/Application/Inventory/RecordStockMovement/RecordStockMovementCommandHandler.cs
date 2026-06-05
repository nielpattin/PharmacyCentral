using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Inventory.Shared;
using PharmacyCentral.Domain.Inventory;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Inventory.RecordStockMovement;

public sealed class RecordStockMovementCommandHandler(IApplicationDbContext dbContext, StockMovementRecorder recorder, AuditLogService auditLogService)
{
    public async Task<Result<StockLedgerEntryDetails>> HandleAsync(RecordStockMovementCommand command, CancellationToken cancellationToken)
    {
        Result<StockLedgerEntry> result = await recorder.RecordAsync(command, cancellationToken);
        if (result.IsFailure)
        {
            return result.Error;
        }

        await auditLogService.RecordAsync(AuditActions.Posted, AuditEntityTypes.StockLedgerEntry, result.Value.Id, command.CreatedByUserId, command.SiteId, $"Posted stock movement {command.MovementType}", cancellationToken: cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return StockLedgerEntryDetails.From(result.Value);
    }
}
