using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Procurement.GetPurchaseOrderById;
using PharmacyCentral.Application.Procurement.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.PurchaseOrders;

internal sealed class GetPurchaseOrderById : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("purchase-orders/{id:guid}", async (
            Guid id,
            IIdentityService identityService,
            GetPurchaseOrderByIdHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<PurchaseOrderDetails> result = await handler.HandleAsync(id, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description, code = result.Error.Code });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, result.Value.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            return Results.Ok(result.Value);
        }).WithTags(Tags.PurchaseOrders).RequireAuthorization(Policies.AnyRole);
    }
}
