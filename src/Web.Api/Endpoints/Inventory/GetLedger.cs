using PharmacyCentral.Application.Inventory.ListStockLedgerEntries;
using PharmacyCentral.Application.Inventory.Shared;
using PharmacyCentral.Infrastructure.Authorization;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Inventory;

internal sealed class GetLedger : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("inventory/ledger", async (
            Guid? productId,
            Guid? productBatchId,
            Guid? siteId,
            Guid? storageLocationId,
            int? limit,
            ListStockLedgerEntriesQueryHandler handler,
            CancellationToken cancellationToken) =>
        {
            ListStockLedgerEntriesQuery query = new()
            {
                ProductId = productId,
                ProductBatchId = productBatchId,
                SiteId = siteId,
                StorageLocationId = storageLocationId,
                Limit = limit ?? 100
            };

            Result<IReadOnlyList<StockLedgerEntryDetails>> result = await handler.HandleAsync(query, cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Inventory)
        .RequireAuthorization(Policies.AnyRole);
    }
}
