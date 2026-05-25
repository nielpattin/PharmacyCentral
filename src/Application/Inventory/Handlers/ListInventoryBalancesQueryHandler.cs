using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Inventory.Models;
using PharmacyCentral.Application.Inventory.Queries;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Inventory.Handlers;

public sealed class ListInventoryBalancesQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<IReadOnlyList<InventoryBalanceDetails>>> HandleAsync(ListInventoryBalancesQuery query, CancellationToken cancellationToken)
    {
        List<InventoryBalanceDetails> balances = (await dbContext.ListInventoryBalancesAsync(
                query.ProductId,
                query.SiteId,
                query.StorageLocationId,
                query.IncludeZeroBalances,
                cancellationToken))
            .Select(InventoryBalanceDetails.From)
            .ToList();

        return balances;
    }
}
