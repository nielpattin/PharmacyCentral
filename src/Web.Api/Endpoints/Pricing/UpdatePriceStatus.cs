using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Pricing.Shared;
using PharmacyCentral.Application.Pricing.UpdatePriceStatus;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Pricing;

internal sealed class UpdatePriceStatus : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        MapAction(app, "publish");
        MapAction(app, "archive");
    }

    private static void MapAction(IEndpointRouteBuilder app, string action)
    {
        app.MapPost($"pricing/prices/{{id:guid}}/{action}", async (
            Guid id,
            PriceStatusRequest request,
            IIdentityService identityService,
            UpdatePriceStatusHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<ProductPriceDetails> result = await handler.HandleAsync(new UpdatePriceStatusCommand(id, action, currentUser.Id, request.Notes), cancellationToken);
            if (result.IsFailure)
            {
                return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            }

            if (result.Value.SiteId is not null && !EndpointSiteAccess.CanAccessSite(currentUser, result.Value.SiteId.Value))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            return Results.Ok(result.Value);
        }).WithTags(Tags.Pricing).RequireAuthorization(Policies.Management);
    }
}
