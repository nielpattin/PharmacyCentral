using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Pricing.GetActivePrice;
using PharmacyCentral.Application.Pricing.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Pricing;

internal sealed class GetActivePrice : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("pricing/active", async (
            Guid productId,
            Guid? siteId,
            DateOnly? effectiveDate,
            IIdentityService identityService,
            GetActivePriceHandler handler,
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

            Result<ProductPriceDetails> result = await handler.HandleAsync(new GetActivePriceQuery(productId, siteId, effectiveDate ?? DateOnly.FromDateTime(DateTime.UtcNow)), cancellationToken);
            return result.IsFailure
                ? Results.NotFound(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Pricing).RequireAuthorization(Policies.AnyRole);
    }
}
