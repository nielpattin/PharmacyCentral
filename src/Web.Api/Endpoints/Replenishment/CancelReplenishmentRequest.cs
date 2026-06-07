using Microsoft.AspNetCore.Mvc;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Replenishment.CancelReplenishmentRequest;
using PharmacyCentral.Application.Replenishment.GetReplenishmentRequestById;
using PharmacyCentral.Application.Replenishment.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Replenishment;

internal sealed class CancelReplenishmentRequest : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("replenishment-requests/{id:guid}/cancel", async (
            Guid id,
            [FromServices] IIdentityService identityService,
            [FromServices] GetReplenishmentRequestByIdHandler getHandler,
            [FromServices] CancelReplenishmentRequestHandler cancelHandler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<ReplenishmentRequestDetails> existing = await getHandler.HandleAsync(new GetReplenishmentRequestByIdQuery { ReplenishmentRequestId = id }, cancellationToken);
            if (existing.IsFailure)
            {
                return Results.NotFound(new { error = existing.Error.Description, code = existing.Error.Code });
            }

            if (!ReplenishmentAccess.CanCancelRequest(currentUser.Roles, currentUser.IsPlatformAdmin, existing.Value.RequestedByUserId, currentUser.Id))
            {
                return Results.Forbid();
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, existing.Value.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            Result<ReplenishmentRequestDetails> result = await cancelHandler.HandleAsync(new CancelReplenishmentRequestCommand
            {
                ReplenishmentRequestId = id,
                CancelledByUserId = currentUser.Id
            }, cancellationToken);

            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Replenishment).RequireAuthorization(Policies.Replenishment);
    }
}
