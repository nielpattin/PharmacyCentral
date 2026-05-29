using PharmacyCentral.Application.Stocktakes.Handlers;
using PharmacyCentral.Application.Stocktakes.Models;
using PharmacyCentral.Application.Stocktakes.Queries;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class ListStocktakeSessions : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("stocktake-sessions", async (Guid? siteId, string? status, int? limit, ListStocktakeSessionsQueryHandler handler, CancellationToken cancellationToken) =>
        {
            IReadOnlyList<StocktakeSessionDetails> sessions = await handler.HandleAsync(new ListStocktakeSessionsQuery { SiteId = siteId, Status = status, Limit = limit ?? 100 }, cancellationToken);
            return Results.Ok(sessions);
        }).WithTags(Tags.Stocktakes).RequireAuthorization();
    }
}
