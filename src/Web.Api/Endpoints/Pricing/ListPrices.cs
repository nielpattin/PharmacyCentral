using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Pricing.ListPrices;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Pricing;

internal sealed class ListPrices : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("pricing/prices", async (
            Guid? productId,
            Guid? siteId,
            string? status,
            int? limit,
            IIdentityService identityService,
            ListPricesHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            if (siteId is not null && !EndpointSiteAccess.CanAccessSite(currentUser, siteId.Value))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            ListPricesQuery query = new(productId, siteId, EndpointSiteAccess.GetAllowedSiteIds(currentUser), status, limit ?? 100);
            return Results.Ok(await handler.HandleAsync(query, cancellationToken));
        }).WithTags(Tags.Pricing).RequireAuthorization(Policies.AnyRole);
    }
}
