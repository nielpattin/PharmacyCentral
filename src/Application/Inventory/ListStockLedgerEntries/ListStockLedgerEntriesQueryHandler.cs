using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Inventory.Shared;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Inventory.ListStockLedgerEntries;

public sealed class ListStockLedgerEntriesQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<StockLedgerEntryDetails>>> HandleAsync(ListStockLedgerEntriesQuery query, CancellationToken cancellationToken)
    {
        var entries = (await dbContext.ListStockLedgerEntriesAsync(
                query.ProductId,
                query.ProductBatchId,
                query.SiteId,
                query.AllowedSiteIds,
                query.StorageLocationId,
                query.Limit,
                cancellationToken))
            .Select(StockLedgerEntryDetails.From)
            .ToList();

        return entries;
    }
}
