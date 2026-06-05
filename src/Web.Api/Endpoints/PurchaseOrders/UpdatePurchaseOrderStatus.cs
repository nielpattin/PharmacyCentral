using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Procurement.GetPurchaseOrderById;
using PharmacyCentral.Application.Procurement.Shared;
using PharmacyCentral.Application.Procurement.UpdatePurchaseOrderStatus;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.PurchaseOrders;

internal sealed class UpdatePurchaseOrderStatus : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        MapAction(app, "approve");
        MapAction(app, "cancel");
    }

    private static void MapAction(IEndpointRouteBuilder app, string action)
    {
        app.MapPost($"purchase-orders/{{id:guid}}/{action}", async (
            Guid id,
            PurchaseOrderStatusRequest request,
            IIdentityService identityService,
            GetPurchaseOrderByIdHandler getHandler,
            UpdatePurchaseOrderStatusHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<PurchaseOrderDetails> existing = await getHandler.HandleAsync(id, cancellationToken);
            if (existing.IsFailure)
            {
                return Results.NotFound(new { error = existing.Error.Description, code = existing.Error.Code });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, existing.Value.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            Result<PurchaseOrderDetails> result = await handler.HandleAsync(new UpdatePurchaseOrderStatusCommand(id, action, currentUser.Id, request.Notes), cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.PurchaseOrders).RequireAuthorization(Policies.Management);
    }
}
