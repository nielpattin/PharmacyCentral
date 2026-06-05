using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Quality.ReviewProductBatchQuality;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Quality;

internal sealed class ReviewProductBatchQuality : IEndpoint
{
    public sealed class Request
    {
        public string? Notes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("quality/batches/{batchId:guid}/release", async (
            Guid batchId,
            Request request,
            IIdentityService identityService,
            ReviewProductBatchQualityHandler handler,
            CancellationToken cancellationToken) =>
        {
            return await ReviewAsync(batchId, "Release", request, identityService, handler, cancellationToken);
        })
        .WithTags(Tags.Quality)
        .RequireAuthorization(Policies.Warehouse);

        app.MapPost("quality/batches/{batchId:guid}/reject", async (
            Guid batchId,
            Request request,
            IIdentityService identityService,
            ReviewProductBatchQualityHandler handler,
            CancellationToken cancellationToken) =>
        {
            return await ReviewAsync(batchId, "Reject", request, identityService, handler, cancellationToken);
        })
        .WithTags(Tags.Quality)
        .RequireAuthorization(Policies.Warehouse);
    }

    private static async Task<IResult> ReviewAsync(
        Guid batchId,
        string decision,
        Request request,
        IIdentityService identityService,
        ReviewProductBatchQualityHandler handler,
        CancellationToken cancellationToken)
    {
        AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
        if (currentUser is null)
        {
            return Results.Unauthorized();
        }

        ReviewProductBatchQualityCommand command = new()
        {
            ProductBatchId = batchId,
            Decision = decision,
            Notes = request.Notes,
            ReviewedByUserId = currentUser.Id,
            AllowedSiteIds = EndpointSiteAccess.GetAllowedSiteIds(currentUser)
        };

        Result<ProductBatchQualityDetails> result = await handler.HandleAsync(command, cancellationToken);
        if (result.IsFailure)
        {
            return result.Error.Code == "quality.site_access_denied"
                ? EndpointSiteAccess.ForbidSiteAccess()
                : Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
        }

        return Results.Ok(result.Value);
    }
}
