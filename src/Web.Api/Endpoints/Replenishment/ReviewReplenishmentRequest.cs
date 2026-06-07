using Microsoft.AspNetCore.Mvc;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Replenishment.GetReplenishmentRequestById;
using PharmacyCentral.Application.Replenishment.ReviewReplenishmentRequest;
using PharmacyCentral.Application.Replenishment.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Replenishment;

internal sealed class ReviewReplenishmentRequest : IEndpoint
{
    public sealed class Request
    {
        public string? ReviewNotes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        MapReview(app, "approve", approved: true);
        MapReview(app, "reject", approved: false);
    }

    private static void MapReview(IEndpointRouteBuilder app, string action, bool approved)
    {
        app.MapPost($"replenishment-requests/{{id:guid}}/{action}", async (
            Guid id,
            Request request,
            [FromServices] IIdentityService identityService,
            [FromServices] GetReplenishmentRequestByIdHandler getHandler,
            [FromServices] ReviewReplenishmentRequestHandler reviewHandler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            if (!ReplenishmentAccess.CanReviewRequest(currentUser.Roles, currentUser.IsPlatformAdmin))
            {
                return Results.Forbid();
            }

            Result<ReplenishmentRequestDetails> existing = await getHandler.HandleAsync(new GetReplenishmentRequestByIdQuery { ReplenishmentRequestId = id }, cancellationToken);
            if (existing.IsFailure)
            {
                return Results.NotFound(new { error = existing.Error.Description, code = existing.Error.Code });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, existing.Value.SiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            Result<ReplenishmentRequestDetails> result = await reviewHandler.HandleAsync(new ReviewReplenishmentRequestCommand
            {
                ReplenishmentRequestId = id,
                ReviewedByUserId = currentUser.Id,
                Approved = approved,
                ReviewNotes = request.ReviewNotes
            }, cancellationToken);

            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Replenishment).RequireAuthorization(Policies.Replenishment);
    }
}
