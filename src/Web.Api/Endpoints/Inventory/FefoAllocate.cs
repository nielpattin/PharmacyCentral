using PharmacyCentral.Application.Inventory.Commands;
using PharmacyCentral.Application.Inventory.Handlers;
using PharmacyCentral.Application.Inventory.Models;
using SharedKernel.Results;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

namespace Web.Api.Endpoints.Inventory;

internal sealed class FefoAllocate : IEndpoint
{
    public sealed class Request
    {
        public Guid ProductId { get; set; }

        public Guid SiteId { get; set; }

        public decimal QuantityNeeded { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("inventory/fefo-allocate", async (
            Request request,
            FefoAllocateCommandHandler handler,
            CancellationToken cancellationToken) =>
        {
            Dictionary<string, string[]> validationErrors = Validate(request);
            if (validationErrors.Count != 0)
            {
                return Results.ValidationProblem(validationErrors);
            }

            FefoAllocateCommand command = new()
            {
                ProductId = request.ProductId,
                SiteId = request.SiteId,
                QuantityNeeded = request.QuantityNeeded
            };

            Result<FefoAllocationResult> result = await handler.HandleAsync(command, cancellationToken);
            if (result.IsFailure)
            {
                return Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code });
            }

            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Inventory)
        .RequireAuthorization(Policies.AnyRole);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.ProductId == Guid.Empty)
        {
            errors[nameof(request.ProductId)] = ["ProductId is required."];
        }

        if (request.SiteId == Guid.Empty)
        {
            errors[nameof(request.SiteId)] = ["SiteId is required."];
        }

        if (request.QuantityNeeded <= 0)
        {
            errors[nameof(request.QuantityNeeded)] = ["QuantityNeeded must be greater than zero."];
        }

        return errors;
    }
}
