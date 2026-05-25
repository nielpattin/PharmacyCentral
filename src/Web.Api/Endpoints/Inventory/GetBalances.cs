using PharmacyCentral.Application.Inventory.Handlers;
using PharmacyCentral.Application.Inventory.Models;
using PharmacyCentral.Application.Inventory.Queries;
using SharedKernel.Results;
using Web.Api.Endpoints;

namespace Web.Api.Endpoints.Inventory;

internal sealed class GetBalances : IEndpoint
{
    public void MapEndpoint(IEndpointRouteBuilder app)
    {
        app.MapGet("inventory/balances", async (
            Guid? productId,
            Guid? siteId,
            Guid? storageLocationId,
            bool? includeZeroBalances,
            ListInventoryBalancesQueryHandler handler,
            CancellationToken cancellationToken) =>
        {
            ListInventoryBalancesQuery query = new()
            {
                ProductId = productId,
                SiteId = siteId,
                StorageLocationId = storageLocationId,
                IncludeZeroBalances = includeZeroBalances ?? false
            };

            Result<IReadOnlyList<InventoryBalanceDetails>> result = await handler.HandleAsync(query, cancellationToken);
            return Results.Ok(result.Value);
        })
        .WithTags(Tags.Inventory)
        .RequireAuthorization();
    }
}
