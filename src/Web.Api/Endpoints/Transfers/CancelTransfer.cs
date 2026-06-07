using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Transfers.CancelTransfer;
using PharmacyCentral.Application.Transfers.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Transfers;

internal sealed class CancelTransfer : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("transfers/{id:guid}/cancel", async (
            Guid id,
            IIdentityService identityService,
            CancelTransferHandler handler,
            IApplicationDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            var transfer = await dbContext.GetTransferByIdAsync(id, cancellationToken);
            if (transfer is null)
            {
                return Results.NotFound(new { error = $"Transfer '{id}' was not found." });
            }

            if (!EndpointSiteAccess.CanAccessAnySite(currentUser, transfer.SourceSiteId, transfer.DestinationSiteId))
            {
                return EndpointSiteAccess.ForbidSiteAccess();
            }

            CancelTransferCommand command = new()
            {
                TransferId = id,
                CancelledByUserId = currentUser.Id
            };

            Result<TransferOrderDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Transfers).RequireAuthorization(Policies.Warehouse);
    }
}
