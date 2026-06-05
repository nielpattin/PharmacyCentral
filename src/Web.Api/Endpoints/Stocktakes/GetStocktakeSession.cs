using PharmacyCentral.Application.Stocktakes.GetStocktakeSessionById;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class GetStocktakeSession : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("stocktake-sessions/{id:guid}", async (Guid id, GetStocktakeSessionByIdQueryHandler handler, CancellationToken cancellationToken) =>
        {
            Result<StocktakeSessionDetails> result = await handler.HandleAsync(new GetStocktakeSessionByIdQuery { StocktakeSessionId = id }, cancellationToken);
            return result.IsFailure ? Results.NotFound(new { error = result.Error.Description, code = result.Error.Code }) : Results.Ok(result.Value);
        }).WithTags(Tags.Stocktakes).RequireAuthorization(Policies.Warehouse);
    }
}
