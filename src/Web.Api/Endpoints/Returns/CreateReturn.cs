using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Models;
using PharmacyCentral.Application.Inventory.Models;
using PharmacyCentral.Application.Returns;
using PharmacyCentral.Application.Returns.Commands;
using PharmacyCentral.Application.Returns.Handlers;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Returns;

internal sealed class CreateReturn : IEndpoint
{
    public sealed class Request
    {
        public Guid ProductId { get; set; }

        public Guid ProductBatchId { get; set; }

        public Guid SiteId { get; set; }

        public Guid StorageLocationId { get; set; }

        public decimal Quantity { get; set; }

        public string Reason { get; set; } = string.Empty;

        public string? Destination { get; set; }

        public DateTimeOffset? OccurredAtUtc { get; set; }

        public string? Notes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("returns", async (
            Request request,
            IIdentityService identityService,
            CreateReturnHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Dictionary<string, string[]> validationErrors = Validate(request);
            if (validationErrors.Count != 0)
            {
                return Results.ValidationProblem(validationErrors);
            }

            CreateReturnCommand command = new()
            {
                ProductId = request.ProductId,
                ProductBatchId = request.ProductBatchId,
                SiteId = request.SiteId,
                StorageLocationId = request.StorageLocationId,
                Quantity = request.Quantity,
                Reason = request.Reason,
                Destination = request.Destination,
                OccurredAtUtc = request.OccurredAtUtc,
                Notes = request.Notes,
                CreatedByUserId = currentUser.Id
            };

            Result<StockLedgerEntryDetails> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            }

            return Results.Created($"/api/inventory/ledger/{result.Value.Id}", result.Value);
        })
        .WithTags(Tags.Returns)
        .RequireAuthorization(Policies.Store);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.ProductId == Guid.Empty)
        {
            errors[nameof(request.ProductId)] = ["ProductId is required."];
        }

        if (request.ProductBatchId == Guid.Empty)
        {
            errors[nameof(request.ProductBatchId)] = ["ProductBatchId is required."];
        }

        if (request.SiteId == Guid.Empty)
        {
            errors[nameof(request.SiteId)] = ["SiteId is required."];
        }

        if (request.StorageLocationId == Guid.Empty)
        {
            errors[nameof(request.StorageLocationId)] = ["StorageLocationId is required."];
        }

        if (request.Quantity <= 0)
        {
            errors[nameof(request.Quantity)] = ["Quantity must be greater than zero."];
        }

        AddRequired(errors, nameof(request.Reason), request.Reason);
        if (!string.IsNullOrWhiteSpace(request.Reason) && !ReturnsConstants.Reasons.Contains(request.Reason.Trim()))
        {
            errors[nameof(request.Reason)] = ["Reason is not supported."];
        }

        AddMaxLength(errors, nameof(request.Reason), request.Reason, 50);
        AddMaxLength(errors, nameof(request.Destination), request.Destination, 200);
        AddMaxLength(errors, nameof(request.Notes), request.Notes, 1000);

        return errors;
    }

    private static void AddRequired(Dictionary<string, string[]> errors, string fieldName, string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            errors[fieldName] = [$"{fieldName} is required."];
        }
    }

    private static void AddMaxLength(Dictionary<string, string[]> errors, string fieldName, string? value, int maxLength)
    {
        if (!string.IsNullOrWhiteSpace(value) && value.Trim().Length > maxLength)
        {
            errors[fieldName] = [$"{fieldName} must be {maxLength} characters or fewer."];
        }
    }
}
