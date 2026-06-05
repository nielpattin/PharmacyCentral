using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Recalls.Shared;
using PharmacyCentral.Application.Recalls.UpdateRecallStatus;
using PharmacyCentral.Domain.Recalls;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Recalls;

internal sealed class UpdateRecallStatus : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        MapStatus(app, "recalls/{id:guid}/activate", RecallCaseStatus.Active);
        MapStatus(app, "recalls/{id:guid}/close", RecallCaseStatus.Closed);
        MapStatus(app, "recalls/{id:guid}/cancel", RecallCaseStatus.Cancelled);
    }

    private static void MapStatus(IEndpointRouteBuilder app, string route, string targetStatus)
    {
        app.MapPost(route, async (
            Guid id,
            RecallStatusRequest request,
            IIdentityService identityService,
            UpdateRecallStatusHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null) return Results.Unauthorized();

            Result<RecallCaseDetails> result = await handler.HandleAsync(new UpdateRecallStatusCommand
            {
                RecallCaseId = id,
                TargetStatus = targetStatus,
                UserId = currentUser.Id,
                Notes = request.Notes
            }, cancellationToken);

            if (result.IsFailure) return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Recalls)
        .RequireAuthorization(Policies.Management);
    }
}
