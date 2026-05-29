using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Stocktakes.Models;
using PharmacyCentral.Application.Stocktakes.Queries;
using PharmacyCentral.Domain.Stocktakes;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Stocktakes.Handlers;

public sealed class GetStocktakeSessionByIdQueryHandler(IApplicationDbContext dbContext)
{
    public async Task<Result<StocktakeSessionDetails>> HandleAsync(GetStocktakeSessionByIdQuery query, CancellationToken cancellationToken)
    {
        StocktakeSession? session = await dbContext.GetStocktakeSessionByIdAsync(query.StocktakeSessionId, cancellationToken);
        if (session is null)
        {
            return StocktakeErrors.SessionNotFound(query.StocktakeSessionId);
        }

        return StocktakeSessionDetails.From(session);
    }
}
