using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Stocktakes.Models;
using PharmacyCentral.Application.Stocktakes.Queries;
using PharmacyCentral.Domain.Stocktakes;

namespace PharmacyCentral.Application.Stocktakes.Handlers;

public sealed class ListStockAdjustmentsQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<IReadOnlyList<StockAdjustmentDetails>> HandleAsync(ListStockAdjustmentsQuery query, CancellationToken cancellationToken)
    {
        List<StockAdjustment> adjustments = await dbContext.ListStockAdjustmentsAsync(query.SiteId, NormalizeOptional(query.Status), query.Limit, cancellationToken);
        return adjustments.Select(StockAdjustmentDetails.From).ToList();
    }

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
