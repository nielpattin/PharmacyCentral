using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Inventory.Models;
using PharmacyCentral.Application.Inventory.Queries;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Inventory.Handlers;

public sealed class ListStockLedgerEntriesQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<StockLedgerEntryDetails>>> HandleAsync(ListStockLedgerEntriesQuery query, CancellationToken cancellationToken)
    {
        var entries = (await dbContext.ListStockLedgerEntriesAsync(
                query.ProductId,
                query.ProductBatchId,
                query.SiteId,
                query.StorageLocationId,
                query.Limit,
                cancellationToken))
            .Select(StockLedgerEntryDetails.From)
            .ToList();

        return entries;
    }
}
