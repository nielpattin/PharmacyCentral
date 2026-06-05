using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Application.Stocktakes;
using PharmacyCentral.Domain.Stocktakes;
using SharedKernel.Results;

namespace PharmacyCentral.Application.Stocktakes.GetStocktakeSessionById;

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
