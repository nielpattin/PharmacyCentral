using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Models;
using PharmacyCentral.Application.Transfers.Commands;
using PharmacyCentral.Application.Transfers.Handlers;
using PharmacyCentral.Application.Transfers.Models;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Transfers;

internal sealed class CreateTransfer : IEndpoint
{
    public sealed class Request
    {
        public Guid SourceSiteId { get; set; }

        public Guid SourceStorageLocationId { get; set; }

        public Guid DestinationSiteId { get; set; }

        public Guid DestinationStorageLocationId { get; set; }

        public string? Notes { get; set; }

        public List<LineRequest> Lines { get; set; } = [];
    }

    public sealed class LineRequest
    {
        public Guid ProductId { get; set; }

        public Guid ProductBatchId { get; set; }

        public decimal RequestedQuantity { get; set; }

        public string? Notes { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("transfers", async (
            Request request,
            IIdentityService identityService,
            CreateTransferHandler handler,
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

            CreateTransferCommand command = new()
            {
                SourceSiteId = request.SourceSiteId,
                SourceStorageLocationId = request.SourceStorageLocationId,
                DestinationSiteId = request.DestinationSiteId,
                DestinationStorageLocationId = request.DestinationStorageLocationId,
                CreatedByUserId = currentUser.Id,
                Notes = request.Notes,
                Lines = request.Lines.Select(line => new CreateTransferLineItem
                {
                    ProductId = line.ProductId,
                    ProductBatchId = line.ProductBatchId,
                    RequestedQuantity = line.RequestedQuantity,
                    Notes = line.Notes
                }).ToList()
            };

            Result<TransferOrderDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Created($"/api/transfers/{result.Value.Id}", result.Value);
        }).WithTags(Tags.Transfers).RequireAuthorization();
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.SourceSiteId == Guid.Empty)
        {
            errors[nameof(request.SourceSiteId)] = ["SourceSiteId is required."];
        }

        if (request.SourceStorageLocationId == Guid.Empty)
        {
            errors[nameof(request.SourceStorageLocationId)] = ["SourceStorageLocationId is required."];
        }

        if (request.DestinationSiteId == Guid.Empty)
        {
            errors[nameof(request.DestinationSiteId)] = ["DestinationSiteId is required."];
        }

        if (request.DestinationStorageLocationId == Guid.Empty)
        {
            errors[nameof(request.DestinationStorageLocationId)] = ["DestinationStorageLocationId is required."];
        }

        if (!string.IsNullOrWhiteSpace(request.Notes) && request.Notes.Trim().Length > 1000)
        {
            errors[nameof(request.Notes)] = ["Notes must be 1000 characters or fewer."];
        }

        if (request.Lines.Count == 0)
        {
            errors[nameof(request.Lines)] = ["At least one transfer line is required."];
        }

        for (int index = 0; index < request.Lines.Count; index++)
        {
            LineRequest line = request.Lines[index];

            if (line.ProductId == Guid.Empty)
            {
                errors[$"Lines[{index}].ProductId"] = ["ProductId is required."];
            }

            if (line.ProductBatchId == Guid.Empty)
            {
                errors[$"Lines[{index}].ProductBatchId"] = ["ProductBatchId is required."];
            }

            if (line.RequestedQuantity <= 0)
            {
                errors[$"Lines[{index}].RequestedQuantity"] = ["RequestedQuantity must be greater than zero."];
            }
        }

        return errors;
    }
}
