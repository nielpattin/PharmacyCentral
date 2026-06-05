using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Recalls.Shared;
using PharmacyCentral.Application.Recalls.UpdateAffectedBatch;
using PharmacyCentral.Domain.Recalls;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Recalls;

internal sealed class UpdateAffectedBatch : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("recalls/{id:guid}/affected-batches/{affectedBatchId:guid}", async (
            Guid id,
            Guid affectedBatchId,
            RecallAffectedBatchStatusRequest request,
            IIdentityService identityService,
            UpdateAffectedBatchHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null) return Results.Unauthorized();

            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0) return Results.ValidationProblem(errors);

            Result<RecallCaseDetails> result = await handler.HandleAsync(new UpdateAffectedBatchCommand
            {
                RecallCaseId = id,
                AffectedBatchId = affectedBatchId,
                Status = request.Status,
                UserId = currentUser.Id,
                Notes = request.Notes
            }, cancellationToken);

            if (result.IsFailure) return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Recalls)
        .RequireAuthorization(Policies.Management);
    }

    private static Dictionary<string, string[]> Validate(RecallAffectedBatchStatusRequest request)
    {
        Dictionary<string, string[]> errors = [];
        if (!RecallBatchStatus.All.Contains(request.Status.Trim()))
        {
            errors[nameof(request.Status)] = ["Status is not supported."];
        }

        if (!string.IsNullOrWhiteSpace(request.Notes) && request.Notes.Trim().Length > 1000)
        {
            errors[nameof(request.Notes)] = ["Notes must be 1000 characters or fewer."];
        }

        return errors;
    }
}
