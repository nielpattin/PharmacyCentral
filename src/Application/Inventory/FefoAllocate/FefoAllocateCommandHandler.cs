using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Inventory.Shared;
using PharmacyCentral.Application.Inventory;
using PharmacyCentral.Domain.Inventory;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Inventory.FefoAllocate;

public sealed class FefoAllocateCommandHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<FefoAllocationResult>> HandleAsync(FefoAllocateCommand command, CancellationToken cancellationToken)
    {
        List<InventoryBalance> balances = await dbContext.ListBalancesForFefoAsync(command.ProductId, command.SiteId, cancellationToken);
        decimal quantityAvailable = balances.Sum(balance => balance.QuantityOnHand);
        if (quantityAvailable < command.QuantityNeeded)
        {
            return InventoryErrors.InsufficientStockForAllocation(command.QuantityNeeded, quantityAvailable);
        }

        decimal quantityRemaining = command.QuantityNeeded;
        List<FefoAllocationLine> lines = [];

        foreach (InventoryBalance balance in balances)
        {
            if (quantityRemaining == 0)
            {
                break;
            }

            decimal quantityToConsume = Math.Min(balance.QuantityOnHand, quantityRemaining);
            lines.Add(FefoAllocationLine.From(balance, quantityToConsume));
            quantityRemaining -= quantityToConsume;
        }

        FefoAllocationResult result = new(
            command.ProductId,
            command.SiteId,
            command.QuantityNeeded,
            command.QuantityNeeded - quantityRemaining,
            lines);

        return result;
    }
}
