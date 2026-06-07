using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Transfers.Shared;
using PharmacyCentral.Application.Transfers.ShipTransfer;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Transfers;

internal sealed class ShipTransfer : IEndpoint
{
    public sealed class Request
    {
        public List<LineRequest> Lines { get; set; } = [];
    }

    public sealed class LineRequest
    {
        public Guid TransferOrderLineId { get; set; }

        public decimal ShippedQuantity { get; set; }
    }

    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("transfers/{id:guid}/ship", async (
            Guid id,
            Request request,
            IIdentityService identityService,
            ShipTransferHandler handler,
            IApplicationDbContext dbContext,
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

            var transfer = await dbContext.GetTransferByIdAsync(id, cancellationToken);
            if (transfer is null)
            {
                return Results.NotFound(new { error = $"Transfer '{id}' was not found." });
            }

            if (!EndpointSiteAccess.CanAccessSite(currentUser, transfer.SourceSiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            ShipTransferCommand command = new()
            {
                TransferId = id,
                ShippedByUserId = currentUser.Id,
                Lines = request.Lines.Select(line => new ShipTransferLineItem
                {
                    TransferOrderLineId = line.TransferOrderLineId,
                    ShippedQuantity = line.ShippedQuantity
                }).ToList()
            };

            Result<TransferOrderDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Transfers).RequireAuthorization(Policies.Warehouse);
    }

    private static Dictionary<string, string[]> Validate(Request request)
    {
        Dictionary<string, string[]> errors = [];

        if (request.Lines.Count == 0)
        {
            errors[nameof(request.Lines)] = ["At least one line is required."];
        }

        for (int index = 0; index < request.Lines.Count; index++)
        {
            LineRequest line = request.Lines[index];

            if (line.TransferOrderLineId == Guid.Empty)
            {
                errors[$"Lines[{index}].TransferOrderLineId"] = ["TransferOrderLineId is required."];
            }

            if (line.ShippedQuantity <= 0)
            {
                errors[$"Lines[{index}].ShippedQuantity"] = ["ShippedQuantity must be greater than zero."];
            }
        }

        return errors;
    }
}
