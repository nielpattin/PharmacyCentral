using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Stocktakes.ListStocktakeSessions;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class ListStocktakeSessions : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("stocktake-sessions", async (Guid? siteId, string? status, int? limit, ListStocktakeSessionsQueryHandler handler, IIdentityService identityService, CancellationToken cancellationToken) =>
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

            IReadOnlyList<StocktakeSessionDetails> sessions = await handler.HandleAsync(new ListStocktakeSessionsQuery { SiteId = siteId, AllowedSiteIds = allowedSiteIds, Status = status, Limit = limit ?? 100 }, cancellationToken);
            return Results.Ok(sessions);
        }).WithTags(Tags.Stocktakes).RequireAuthorization(Policies.Warehouse);
    }
}
