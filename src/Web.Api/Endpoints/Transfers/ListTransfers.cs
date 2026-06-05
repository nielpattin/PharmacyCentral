using PharmacyCentral.Application.Transfers.ListTransfers;
using PharmacyCentral.Application.Transfers.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Transfers;

internal sealed class ListTransfers : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("transfers", async (Guid? siteId, string? status, int? limit, ListTransfersQueryHandler handler, CancellationToken cancellationToken) =>
        {
            IReadOnlyList<TransferOrderDetails> transfers = await handler.HandleAsync(new ListTransfersQuery { SiteId = siteId, Status = status, Limit = limit ?? 100 }, cancellationToken);
            return Results.Ok(transfers);
        }).WithTags(Tags.Transfers).RequireAuthorization(Policies.AnyRole);
    }
}
