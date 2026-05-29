using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Models;
using PharmacyCentral.Application.Transfers.Commands;
using PharmacyCentral.Application.Transfers.Handlers;
using PharmacyCentral.Application.Transfers.Models;
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
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
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
        }).WithTags(Tags.Transfers).RequireAuthorization();
    }
}
