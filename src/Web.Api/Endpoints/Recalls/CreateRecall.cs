using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Recalls.CreateRecall;
using PharmacyCentral.Application.Recalls.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Recalls;

internal sealed class CreateRecall : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("recalls", async (
            RecallCreateRequest request,
            IIdentityService identityService,
            CreateRecallHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null) return Results.Unauthorized();

            Dictionary<string, string[]> errors = Validate(request, currentUser);
            if (errors.Count != 0) return Results.ValidationProblem(errors);

            CreateRecallCommand command = new()
            {
                RecallNumber = request.RecallNumber,
                Title = request.Title,
                Reason = request.Reason,
                Notes = request.Notes,
                CreatedByUserId = currentUser.Id,
                AffectedBatches = request.AffectedBatches.Select(batch => new CreateRecallAffectedBatchCommand
                {
                    ProductBatchId = batch.ProductBatchId,
                    SiteId = batch.SiteId,
                    Notes = batch.Notes
                }).ToList()
            };

            Result<RecallCaseDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure) return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });

            return Results.Created($"/api/recalls/{result.Value.Id}", result.Value);
        })
        .WithTags(Tags.Recalls)
        .RequireAuthorization(Policies.Management);
    }

    private static Dictionary<string, string[]> Validate(RecallCreateRequest request, AuthUserDetails currentUser)
    {
        Dictionary<string, string[]> errors = [];
        AddRequired(errors, nameof(request.RecallNumber), request.RecallNumber);
        AddRequired(errors, nameof(request.Title), request.Title);
        AddRequired(errors, nameof(request.Reason), request.Reason);
        AddMaxLength(errors, nameof(request.RecallNumber), request.RecallNumber, 100);
        AddMaxLength(errors, nameof(request.Title), request.Title, 200);
        AddMaxLength(errors, nameof(request.Reason), request.Reason, 1000);
        AddMaxLength(errors, nameof(request.Notes), request.Notes, 1000);

        if (request.AffectedBatches.Count == 0)
        {
            errors[nameof(request.AffectedBatches)] = ["At least one affected batch is required."];
        }

        for (int i = 0; i < request.AffectedBatches.Count; i++)
        {
            RecallAffectedBatchRequest batch = request.AffectedBatches[i];
            if (batch.ProductBatchId == Guid.Empty)
            {
                errors[$"affectedBatches[{i}].productBatchId"] = ["ProductBatchId is required."];
            }

            if (batch.SiteId is not null && !EndpointSiteAccess.CanAccessSite(currentUser, batch.SiteId.Value))
            {
                errors[$"affectedBatches[{i}].siteId"] = ["Site access is required."];
            }

            AddMaxLength(errors, $"affectedBatches[{i}].notes", batch.Notes, 1000);
        }

        return errors;
    }

    private static void AddRequired(Dictionary<string, string[]> errors, string fieldName, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) errors[fieldName] = [$"{fieldName} is required."];
    }

    private static void AddMaxLength(Dictionary<string, string[]> errors, string fieldName, string? value, int maxLength)
    {
        if (!string.IsNullOrWhiteSpace(value) && value.Trim().Length > maxLength) errors[fieldName] = [$"{fieldName} must be {maxLength} characters or fewer."];
    }
}
