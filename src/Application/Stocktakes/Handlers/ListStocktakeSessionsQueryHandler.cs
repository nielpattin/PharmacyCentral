using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Stocktakes.Models;
using PharmacyCentral.Application.Stocktakes.Queries;
using PharmacyCentral.Domain.Stocktakes;

namespace PharmacyCentral.Application.Stocktakes.Handlers;

public sealed class ListStocktakeSessionsQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<IReadOnlyList<StocktakeSessionDetails>> HandleAsync(ListStocktakeSessionsQuery query, CancellationToken cancellationToken)
    {
        List<StocktakeSession> sessions = await dbContext.ListStocktakeSessionsAsync(query.SiteId, NormalizeOptional(query.Status), query.Limit, cancellationToken);
        return sessions.Select(StocktakeSessionDetails.From).ToList();
    }

    private static string? NormalizeOptional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
