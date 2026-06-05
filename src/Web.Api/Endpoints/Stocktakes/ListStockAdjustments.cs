using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Stocktakes.ListStockAdjustments;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class ListStockAdjustments : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("stock-adjustments", async (Guid? siteId, string? status, int? limit, ListStockAdjustmentsQueryHandler handler, IIdentityService identityService, CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            if (!EndpointSiteAccess.TryAuthorizeRequestedSite(currentUser, siteId, out IReadOnlyCollection<Guid>? allowedSiteIds))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            IReadOnlyList<StockAdjustmentDetails> adjustments = await handler.HandleAsync(new ListStockAdjustmentsQuery { SiteId = siteId, AllowedSiteIds = allowedSiteIds, Status = status, Limit = limit ?? 100 }, cancellationToken);
            return Results.Ok(adjustments);
        }).WithTags(Tags.Stocktakes).RequireAuthorization(Policies.Warehouse);
    }
}
