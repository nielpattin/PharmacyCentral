using Microsoft.AspNetCore.Mvc;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Replenishment.GetReplenishmentRequestById;
using PharmacyCentral.Application.Replenishment.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Replenishment;

internal sealed class GetReplenishmentRequest : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("replenishment-requests/{id:guid}", async (
            Guid id,
            [FromServices] IIdentityService identityService,
            [FromServices] GetReplenishmentRequestByIdHandler handler,
            CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<ReplenishmentRequestDetails> result = await handler.HandleAsync(new GetReplenishmentRequestByIdQuery { ReplenishmentRequestId = id }, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description, code = result.Error.Code });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, result.Value.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            return Results.Ok(result.Value);
        }).WithTags(Tags.Replenishment).RequireAuthorization(Policies.Replenishment);
    }
}
