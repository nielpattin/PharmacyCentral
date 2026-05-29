using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Inventory.Commands;
using PharmacyCentral.Application.Inventory.Models;
using PharmacyCentral.Domain.Inventory;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Inventory.Handlers;

public sealed class RecordStockMovementCommandHandler(IApplicationDbContext dbContext, StockMovementRecorder recorder)
{
    public async Task<Result<StockLedgerEntryDetails>> HandleAsync(RecordStockMovementCommand command, CancellationToken cancellationToken)
    {
        Result<StockLedgerEntry> result = await recorder.RecordAsync(command, cancellationToken);
        if (result.IsFailure)
        {
            return result.Error;
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        return StockLedgerEntryDetails.From(result.Value);
    }
}
