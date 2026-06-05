using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Stocktakes.CreateStockAdjustment;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Application.Stocktakes;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Stocktakes;

internal sealed class CreateStockAdjustment : IEndpoint
{
    public sealed class Request
    {
        public Guid ProductId { get; set; }
        public Guid ProductBatchId { get; set; }
        public Guid SiteId { get; set; }
        public Guid StorageLocationId { get; set; }
        public string AdjustmentType { get; set; } = string.Empty;
        public decimal Quantity { get; set; }
        public string Reason { get; set; } = string.Empty;
        public string? Notes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("stock-adjustments", async (
            Request request,
            IIdentityService identityService,
            CreateStockAdjustmentHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Dictionary<string, string[]> errors = Validate(request);
            if (errors.Count != 0)
            {
                return Results.ValidationProblem(errors);
            }

            CreateStockAdjustmentCommand command = new()
            {
                ProductId = request.ProductId,
                ProductBatchId = request.ProductBatchId,
                SiteId = request.SiteId,
                StorageLocationId = request.StorageLocationId,
                AdjustmentType = request.AdjustmentType,
                Quantity = request.Quantity,
                Reason = request.Reason,
                CreatedByUserId = currentUser.Id,
                Notes = request.Notes
            };

            Result<StockAdjustmentDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Created($"/api/stock-adjustments/{result.Value.Id}", result.Value);
        }).WithTags(Tags.Stocktakes).RequireAuthorization(Policies.Warehouse);
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

        if (string.IsNullOrWhiteSpace(request.AdjustmentType))
        {
            errors[nameof(request.AdjustmentType)] = ["AdjustmentType is required."];
        }
        else if (request.AdjustmentType is not ("Positive" or "Negative"))
        {
            errors[nameof(request.AdjustmentType)] = ["AdjustmentType must be 'Positive' or 'Negative'."];
        }

        if (string.IsNullOrWhiteSpace(request.Reason))
        {
            errors[nameof(request.Reason)] = ["Reason is required."];
        }

        return errors;
    }
}
