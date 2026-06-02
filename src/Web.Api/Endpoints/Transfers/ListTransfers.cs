using PharmacyCentral.Application.Transfers.Handlers;
using PharmacyCentral.Application.Transfers.Models;
using PharmacyCentral.Application.Transfers.Queries;
using Web.Api.Endpoints;
using PharmacyCentral.Infrastructure.Authorization;

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
