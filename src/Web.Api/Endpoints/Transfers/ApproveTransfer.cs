using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Auth.Shared;
using PharmacyCentral.Application.Transfers.ApproveTransfer;
using PharmacyCentral.Application.Transfers.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Transfers;

internal sealed class ApproveTransfer : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapPost("transfers/{id:guid}/approve", async (
            Guid id,
            IIdentityService identityService,
            ApproveTransferHandler handler,
            CancellationToken cancellationToken) =>
        {
            AuthUserDetails? currentUser = await identityService.GetCurrentUserAsync(cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            ApproveTransferCommand command = new()
            {
                TransferId = id,
                ApprovedByUserId = currentUser.Id
            };

            Result<TransferOrderDetails> result = await handler.HandleAsync(command, cancellationToken);
            return result.IsFailure
                ? Results.BadRequest(new { error = result.Error.Description, code = result.Error.Code })
                : Results.Ok(result.Value);
        }).WithTags(Tags.Transfers).RequireAuthorization(Policies.AnyRole);
    }
}
