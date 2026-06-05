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
        app.MapGet("transfers/{id:guid}", async (Guid id, GetTransferByIdQueryHandler handler, CancellationToken cancellationToken) =>
        {
            Result<TransferOrderDetails> result = await handler.HandleAsync(new GetTransferByIdQuery { TransferId = id }, cancellationToken);
            return result.IsFailure ? Results.NotFound(new { error = result.Error.Description, code = result.Error.Code }) : Results.Ok(result.Value);
        }).WithTags(Tags.Transfers).RequireAuthorization(Policies.AnyRole);
    }
}
