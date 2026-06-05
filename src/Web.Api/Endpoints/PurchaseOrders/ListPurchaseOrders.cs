using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Procurement.ListPurchaseOrders;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.PurchaseOrders;

internal sealed class ListPurchaseOrders : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("purchase-orders", async (
            Guid? siteId,
            string? status,
            int? limit,
            IIdentityService identityService,
            ListPurchaseOrdersHandler handler,
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

            ListPurchaseOrdersQuery query = new(siteId, EndpointSiteAccess.GetAllowedSiteIds(currentUser), status, limit ?? 100);
            return Results.Ok(await handler.HandleAsync(query, cancellationToken));
        }).WithTags(Tags.PurchaseOrders).RequireAuthorization(Policies.AnyRole);
    }
}
