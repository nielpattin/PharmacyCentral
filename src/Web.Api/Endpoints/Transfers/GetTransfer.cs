using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Transfers.GetTransferById;
using PharmacyCentral.Application.Transfers.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Transfers;

internal sealed class GetTransfer : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("transfers/{id:guid}", async (Guid id, GetTransferByIdQueryHandler handler, IIdentityService identityService, CancellationToken cancellationToken) =>
        {
            var currentUser = await EndpointSiteAccess.GetCurrentUserAsync(identityService, cancellationToken);
            if (currentUser is null)
            {
                return Results.Unauthorized();
            }

            Result<TransferOrderDetails> result = await handler.HandleAsync(new GetTransferByIdQuery { TransferId = id }, cancellationToken);
            if (result.IsFailure)
            {
                return Results.NotFound(new { error = result.Error.Description, code = result.Error.Code });
            }

            return EndpointSiteAccess.CanAccessAnySite(currentUser, result.Value.SourceSiteId, result.Value.DestinationSiteId)
                ? Results.Ok(result.Value)
                : EndpointSiteAccess.ForbidSiteAccess();
        }).WithTags(Tags.Transfers).RequireAuthorization(Policies.Warehouse);
    }
}
