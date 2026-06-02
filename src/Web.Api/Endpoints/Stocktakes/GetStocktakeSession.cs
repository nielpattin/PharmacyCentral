using PharmacyCentral.Application.Stocktakes.Handlers;
using PharmacyCentral.Application.Stocktakes.Models;
using PharmacyCentral.Application.Stocktakes.Queries;
using SharedKernel.Results;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

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
