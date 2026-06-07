using Microsoft.AspNetCore.Mvc;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Replenishment.ListReplenishmentRequests;
using PharmacyCentral.Application.Replenishment.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Replenishment;

internal sealed class ListReplenishmentRequests : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("replenishment-requests", async (
            Guid? siteId,
            string? status,
            int? limit,
            [FromServices] IIdentityService identityService,
            [FromServices] ListReplenishmentRequestsHandler handler,
            CancellationToken cancellationToken) =>
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

            IReadOnlyList<ReplenishmentRequestDetails> requests = await handler.HandleAsync(new ListReplenishmentRequestsQuery
            {
                SiteId = siteId,
                AllowedSiteIds = allowedSiteIds,
                Status = status,
                Limit = limit ?? 100
            }, cancellationToken);

            return Results.Ok(requests);
        }).WithTags(Tags.Replenishment).RequireAuthorization(Policies.Replenishment);
    }
}
