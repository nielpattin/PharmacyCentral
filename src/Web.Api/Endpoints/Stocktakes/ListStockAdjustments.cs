using PharmacyCentral.Application.Stocktakes.Handlers;
using PharmacyCentral.Application.Stocktakes.Models;
using PharmacyCentral.Application.Stocktakes.Queries;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class ListStockAdjustments : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("stock-adjustments", async (Guid? siteId, string? status, int? limit, ListStockAdjustmentsQueryHandler handler, CancellationToken cancellationToken) =>
        {
            IReadOnlyList<StockAdjustmentDetails> adjustments = await handler.HandleAsync(new ListStockAdjustmentsQuery { SiteId = siteId, Status = status, Limit = limit ?? 100 }, cancellationToken);
            return Results.Ok(adjustments);
        }).WithTags(Tags.Stocktakes).RequireAuthorization(Policies.Warehouse);
    }
}
